import { randomUUID } from "node:crypto";
import {
  buildGraph,
  createCheckpointer,
  loadProject,
  setDefaultAgentRunner,
  setDefaultScriptRunner,
  sweepFinalizedRuns,
  threadIdForRun,
  type RunStateType,
  type WorkflowStep,
} from "@wf/workflow-core";
import { CancellationRegistry } from "./cancellation.js";
import { ConcurrencyLimiter } from "./concurrency.js";
import { redactRunArtifacts } from "./redact.js";
import {
  UnknownProjectOrWorkflowError,
  type RunStepView,
  type RunSummaryStatus,
  type RunView,
  type StartRunRequest,
} from "./types.js";

export interface AgentServiceOptions {
  maxConcurrentRuns?: number;
  /** Retention window in ms; finalized runs older than this are swept on `sweepIntervalMs`. */
  retentionWindowMs?: number;
  sweepIntervalMs?: number;
  logger?: { info: (obj: unknown, msg?: string) => void };
}

interface RunEntry {
  status: RunSummaryStatus;
  finalizedAt: Date | null;
}

export interface AgentService {
  startRun(req: StartRunRequest): Promise<{ runId: string }>;
  getRun(runId: string): Promise<RunView | null>;
  cancelRun(runId: string): Promise<boolean>;
  stop(): void;
}

type Checkpointer = Awaited<ReturnType<typeof createCheckpointer>>;

const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Builds the agent-service library: loads the registry lazily per-request (cached by
 * `@wf/workflow-core`'s own registry cache), compiles the graph once, wires the real/dry-run
 * runners, and executes runs via `graph.invoke`. Designed to be imported in-process by
 * `apps/run-api` (see that app's handoff note for the single-process-PoC rationale) rather than
 * exposed over its own HTTP surface.
 */
export async function startAgentService(options: AgentServiceOptions = {}): Promise<AgentService> {
  const log = options.logger ?? jsonConsoleLogger;
  const checkpointer: Checkpointer = await createCheckpointer();
  const graph = buildGraph(checkpointer);

  const cancellation = new CancellationRegistry();
  const limiter = new ConcurrencyLimiter(
    options.maxConcurrentRuns ?? envInt("MAX_CONCURRENT_RUNS", DEFAULT_MAX_CONCURRENT_RUNS),
  );
  const runs = new Map<string, RunEntry>();

  setDefaultAgentRunner((await import("./runners.js")).buildAgentRunner(cancellation));
  setDefaultScriptRunner((await import("./runners.js")).buildScriptRunner(cancellation));

  const retentionWindowMs =
    options.retentionWindowMs ?? envInt("RETENTION_WINDOW_MS", DEFAULT_RETENTION_WINDOW_MS);
  const sweepIntervalMs =
    options.sweepIntervalMs ?? envInt("SWEEP_INTERVAL_MS", DEFAULT_SWEEP_INTERVAL_MS);

  const sweepTimer = setInterval(() => {
    void sweep(checkpointer, runs, retentionWindowMs, log);
  }, sweepIntervalMs).unref();

  async function startRun(req: StartRunRequest): Promise<{ runId: string }> {
    limiter.acquire();
    let project;
    try {
      project = await loadProject(req.project);
    } catch (error) {
      limiter.release();
      throw new UnknownProjectOrWorkflowError(messageOf(error));
    }
    if (project.workflow.id !== req.workflow) {
      limiter.release();
      throw new UnknownProjectOrWorkflowError(
        `workflow "${req.workflow}" does not match project "${req.project}"'s registered workflow "${project.workflow.id}"`,
      );
    }

    const runId = randomUUID();
    const mode = process.env.AGENT_DRY_RUN === "1" ? ("dry-run" as const) : ("live" as const);
    runs.set(runId, { status: "running", finalizedAt: null });
    cancellation.register(runId);

    const initialState: RunStateType = {
      run: {
        id: runId,
        projectId: req.project,
        workflowId: project.workflow.id,
        model: req.model,
        workspace: "",
        createdAt: "",
        mode,
      },
      workflow: project.workflow,
      task: { description: req.task },
      currentStep: null,
      stepIndex: 0,
      results: {},
      status: "running",
    };
    const config = { configurable: { thread_id: threadIdForRun(runId) } };

    log.info(
      { event: "run_started", runId, project: req.project, workflow: req.workflow },
      "run started",
    );

    void graph
      .invoke(initialState, config)
      .then(async (final) => {
        runs.set(runId, { status: final.status, finalizedAt: new Date() });
        await redactRunArtifacts(runId);
        log.info({ event: "run_finished", runId, status: final.status }, "run finished");
      })
      .catch((error: unknown) => {
        runs.set(runId, { status: "failed", finalizedAt: new Date() });
        log.info({ event: "run_error", runId, error: messageOf(error) }, "run errored");
      })
      .finally(() => {
        limiter.release();
        cancellation.release(runId);
      });

    return { runId };
  }

  async function getRun(runId: string): Promise<RunView | null> {
    const entry = runs.get(runId);
    if (!entry) {
      return null;
    }
    const config = { configurable: { thread_id: threadIdForRun(runId) } };
    const snapshot = await graph.getState(config);
    const steps: RunStepView[] = (snapshot.values.workflow?.steps ?? []).map(
      (step: WorkflowStep) => ({
        id: step.id,
        kind: step.kind,
        ok: snapshot.values.results?.[step.id] ? snapshot.values.results[step.id].ok : null,
      }),
    );

    return {
      runId,
      status: entry.status,
      stepIndex: snapshot.values.stepIndex ?? 0,
      steps,
    };
  }

  async function cancelRun(runId: string): Promise<boolean> {
    if (!runs.has(runId)) {
      return false;
    }
    return cancellation.cancel(runId);
  }

  function stop(): void {
    clearInterval(sweepTimer);
  }

  return { startRun, getRun, cancelRun, stop };
}

async function sweep(
  checkpointer: Checkpointer,
  runs: Map<string, RunEntry>,
  retentionWindowMs: number,
  log: { info: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const cutoff = new Date(Date.now() - retentionWindowMs);
  const finalized = Array.from(runs.entries())
    .filter(([, entry]) => entry.finalizedAt !== null)
    .map(([runId, entry]) => ({ runId, finalizedAt: entry.finalizedAt as Date }));
  if (finalized.length === 0) {
    return;
  }
  const deleted = await sweepFinalizedRuns(checkpointer, finalized, cutoff);
  for (const runId of deleted) {
    runs.delete(runId);
  }
  if (deleted.length > 0) {
    log.info({ event: "sweep", deletedRunIds: deleted }, "swept finalized runs");
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Default structured-JSON logger, used when the caller (e.g. run-api) doesn't inject its own
 * (Fastify's pino) logger. One `console.log(JSON.stringify(...))` line per event, per M5's
 * "structured JSON logs" requirement. */
const jsonConsoleLogger = {
  info(obj: unknown, msg?: string): void {
    console.log(JSON.stringify({ ...(obj as Record<string, unknown>), msg }));
  },
};

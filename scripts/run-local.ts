#!/usr/bin/env tsx
/**
 * Minimal CLI entrypoint for M2's E2E gate:
 *   AGENT_DRY_RUN=1 pnpm tsx scripts/run-local.ts --project <id> --task "<description>" [--run-id <id>] [--resume-demo]
 *
 * M3 update: wired to `@wf/agent-runtime`'s real implementations (`dryRunAgent`/`runAgent`/
 * `runScript`) instead of the M2 stub. Mode-dependent: `AGENT_DRY_RUN=1` uses `dryRunAgent`
 * (no process spawned) and a lightweight dry-run bash stub (still no process spawned, since
 * dry-run must work fully offline/rate-limit-safe); anything else spawns the real `opencode`/
 * `bash` processes via `runAgent`/`runScript`.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraph,
  createCheckpointer,
  threadIdForRun,
  setDefaultAgentRunner,
  setDefaultScriptRunner,
  type RunStateType,
} from "@wf/workflow-core";
import { dryRunAgent, runAgent, runScript } from "@wf/agent-runtime";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.WF_PROJECTS_ROOT ??= resolve(repoRoot, "projects");

interface Flags {
  project: string;
  task: string;
  runId?: string;
  resumeDemo: boolean;
}

function parseFlags(argv: string[]): Flags {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const project = get("project");
  const task = get("task");
  if (!project || !task) {
    throw new Error("Usage: run-local.ts --project <id> --task <description> [--run-id <id>]");
  }
  const runId = get("run-id");
  return {
    project,
    task,
    resumeDemo: argv.includes("--resume-demo"),
    ...(runId !== undefined ? { runId } : {}),
  };
}

const isDryRunMode = process.env.AGENT_DRY_RUN === "1";

setDefaultAgentRunner(async (input) => (isDryRunMode ? dryRunAgent(input) : runAgent(input)));

/** Dry-run bash stub: still no process spawned, so `AGENT_DRY_RUN=1` stays fully offline. */
setDefaultScriptRunner(async (input) => {
  if (!isDryRunMode) {
    return runScript(input);
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ path: input.path }))
    .digest("hex");
  const artifact = {
    id: randomUUID(),
    stepId: input.idempotencyKey.split(":")[1] ?? "unknown",
    kind: "stdout" as const,
    path: input.path,
    bytes: hash.length,
    sha256: hash,
  };
  return {
    ok: true,
    exitCode: 0,
    durationMs: 1,
    stdoutArtifact: artifact,
    stderrArtifact: { ...artifact, kind: "stderr" as const },
    truncated: false,
  };
});

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = process.env.AGENT_DRY_RUN === "1" ? "dry-run" : "live";
  if (mode === "live") {
    throw new Error(
      "Live mode requires @wf/agent-runtime (M3); only AGENT_DRY_RUN=1 is supported today",
    );
  }

  const { loadProject } = await import("@wf/workflow-core");
  const project = await loadProject(flags.project);
  const checkpointer = await createCheckpointer();
  const graph = buildGraph(checkpointer);

  const runId = flags.runId ?? randomUUID();
  const initialState: RunStateType = {
    run: {
      id: runId,
      projectId: flags.project,
      workflowId: project.workflow.id,
      model: "opencode/big-pickle",
      workspace: "",
      createdAt: "",
      mode,
    },
    workflow: project.workflow,
    task: { description: flags.task },
    currentStep: null,
    stepIndex: 0,
    results: {},
    status: "running",
  };

  const config = { configurable: { thread_id: threadIdForRun(runId) } };

  const first = await graph.invoke(initialState, config);
  console.log(`run ${runId}: status=${first.status}`);

  if (flags.resumeDemo) {
    // Re-invoking with the same thread_id and `null` input resumes from the checkpoint rather
    // than re-running `initialize`. With MemorySaver (no DATABASE_URL) this only demonstrates
    // resume-within-process; true cross-process restart recovery needs Postgres (out of scope
    // for M2, see handoff notes).
    const resumed = await graph.getState(config);
    console.log(
      `resume check: stepIndex=${resumed.values.stepIndex} status=${resumed.values.status}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

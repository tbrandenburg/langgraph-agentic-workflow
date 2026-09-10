#!/usr/bin/env tsx
/**
 * Minimal CLI entrypoint for M2's E2E gate:
 *   AGENT_DRY_RUN=1 pnpm tsx scripts/run-local.ts --project <id> --task "<description>" [--run-id <id>] [--resume-demo]
 *
 * NOTE (M2 stub, replace in M3): the bash/agent runners wired in here
 * (`dryRunBash`/`dryRunAgent`) are a MINIMAL local stub, not `@wf/agent-runtime`'s real
 * `run-agent.ts`/`run-script.ts`. They synthesize deterministic successful results without
 * spawning any process. M3 must replace `setDefaultAgentRunner`/`setDefaultScriptRunner` calls
 * below with real implementations from `@wf/agent-runtime` (or wire that package's exports in
 * here) without changing the node contract (`RunAgent`/`RunScript` types in
 * `packages/workflow-core/src/nodes/{agent,bash}.ts`).
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
  return {
    project,
    task,
    runId: get("run-id"),
    resumeDemo: argv.includes("--resume-demo"),
  };
}

/** M2 stub agent runner: synthesizes a deterministic result, never spawns `opencode`. */
setDefaultAgentRunner(async (input) => {
  const hash = createHash("sha256")
    .update(JSON.stringify({ role: input.role, promptFile: input.promptFile }))
    .digest("hex")
    .slice(0, 12);
  return {
    ok: true,
    role: input.role,
    stepId: input.input.stepId,
    summary: `[dry-run stub] ${input.role} completed (hash=${hash})`,
    artifacts: [],
  };
});

/** M2 stub bash runner: synthesizes a deterministic success, never spawns a real process. */
setDefaultScriptRunner(async (input) => {
  const artifact = {
    id: randomUUID(),
    stepId: input.idempotencyKey.split(":")[1] ?? "unknown",
    kind: "stdout" as const,
    path: input.path,
    bytes: 0,
    sha256: "0".repeat(64),
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

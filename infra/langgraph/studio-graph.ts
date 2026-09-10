/**
 * LangGraph Studio / `langgraph dev` entry point.
 *
 * This is dev-tooling glue for local visual debugging only — not a package, not wired into
 * `make build`/`make test`. It hosts the `studio-demo` project (see `projects/studio-demo/`)
 * behind a graph that Studio can invoke with minimal manual input.
 *
 * Design decision (documented per task instructions):
 * `langgraph dev`/Studio invokes whatever graph this file exports fresh per run, with
 * user-supplied initial state entered via the Studio UI's JSON form. Our `RunState` shape
 * requires `run`/`workflow` to already be populated before the core `initialize` node can do
 * anything meaningful (project/workflow selection currently happens in
 * `scripts/run-local.ts`/`apps/agent-service`, *before* `graph.invoke()` — the core graph itself
 * has no such node). Asking Studio users to hand-type a full `WorkflowDefinition` JSON blob
 * every time would defeat the "minimal input" goal.
 *
 * Instead of duplicating `buildGraph`'s node wiring, we reuse the compiled core graph verbatim
 * (DRY) and wrap it with a single thin `bootstrap` node that runs first: if `run`/`workflow` are
 * already present in the input (someone wants to drive it directly), it's a no-op; otherwise it
 * loads the `studio-demo` project and fills in sane defaults, so a Studio user can trigger a run
 * with input as small as `{ "task": { "description": "..." } }`.
 *
 * Mode: hardcoded to dry-run (`dryRunAgent` / offline bash stub, mirroring
 * `scripts/run-local.ts`'s `AGENT_DRY_RUN=1` path) unless `AGENT_DRY_RUN=0` is explicitly set —
 * this is a demo/visual-debugging entry point, not a production one, and must stay safe to
 * click "run" on without spawning real processes or hitting rate limits.
 *
 * Checkpointing: deliberately NOT wired here — `buildGraph()` is called with no checkpointer,
 * per the task's core instruction, because the LangGraph API server started by `langgraph dev`
 * manages its own persistence around the compiled graph.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StateGraph, START, END } from "@langchain/langgraph";
import {
  buildGraph,
  loadProject,
  setDefaultAgentRunner,
  setDefaultScriptRunner,
  RunState,
  type RunStateType,
  type RunStateUpdate,
} from "@wf/workflow-core";
import { dryRunAgent, runAgent, runScript } from "@wf/agent-runtime";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.WF_PROJECTS_ROOT ??= resolve(repoRoot, "projects");

const STUDIO_PROJECT_ID = "studio-demo";

// Defaults to dry-run; set AGENT_DRY_RUN=0 to spawn real opencode/bash processes.
const isDryRunMode = process.env.AGENT_DRY_RUN !== "0";

setDefaultAgentRunner(async (input) => (isDryRunMode ? dryRunAgent(input) : runAgent(input)));

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

/**
 * Fills in `run`/`workflow` (and a default `task`) from the `studio-demo` project when they're
 * missing from the Studio-supplied initial state. Leaves an already-fully-specified input
 * untouched, so this graph still works if a caller wants to point it at a different project.
 */
async function bootstrap(state: RunStateType): Promise<RunStateUpdate> {
  if (state.workflow && state.run) {
    return {};
  }

  const project = await loadProject(STUDIO_PROJECT_ID);
  const mode = isDryRunMode ? "dry-run" : "live";

  return {
    run: {
      id: "",
      projectId: STUDIO_PROJECT_ID,
      workflowId: project.workflow.id,
      model: "opencode/big-pickle",
      workspace: "",
      createdAt: "",
      mode,
    },
    workflow: project.workflow,
    task: state.task ?? { description: "Studio demo run" },
    currentStep: null,
    stepIndex: 0,
    results: {},
    status: "running",
  };
}

const core = buildGraph();

export const graph = new StateGraph(RunState)
  .addNode("bootstrap", bootstrap)
  .addNode("core", core)
  .addEdge(START, "bootstrap")
  .addEdge("bootstrap", "core")
  .addEdge("core", END)
  .compile();

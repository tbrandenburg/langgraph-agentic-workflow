import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import { RunState, type RunStateType, type RunStateUpdate } from "./state.js";
import { initializeRun } from "./nodes/initialize.js";
import { advanceWorkflow, routeStep } from "./nodes/advance.js";
import { agentNode } from "./nodes/agent.js";
import { bashNode } from "./nodes/bash.js";
import { publishSummary } from "./nodes/publish.js";

/** Names of the 5 core graph nodes. Used by `NodeMiddleware` for generic per-node wrapping. */
export type NodeName = "initialize" | "advance" | "agent" | "bash" | "publish";

type NodeFn = (state: RunStateType) => RunStateUpdate | Promise<RunStateUpdate>;

/**
 * Optional generic hook to wrap every node function at graph-build time. Intentionally
 * project-content-free (no prompts/commands) — this is generic timing/tracing infra, so it lives
 * here rather than duplicating the graph wiring in `apps/agent-service`. The actual tracing
 * implementation (what to do with start/end events, where to persist them) stays out of
 * `workflow-core` and is injected by the host app (see M6 observability handoff).
 */
export type NodeMiddleware = (name: NodeName, fn: NodeFn) => NodeFn;

const identityMiddleware: NodeMiddleware = (_name, fn) => fn;

/**
 * Builds the reusable core LangGraph graph exactly as documented in INITIAL.md:
 * initialize -> advance -> {agent|bash|publish} -> advance (loop) -> publish -> END.
 */
export function buildGraph(
  checkpointer: BaseCheckpointSaver,
  middleware: NodeMiddleware = identityMiddleware,
) {
  return new StateGraph(RunState)
    .addNode("initialize", middleware("initialize", initializeRun))
    .addNode("advance", middleware("advance", advanceWorkflow))
    .addNode(
      "agent",
      middleware("agent", (state) => agentNode(state)),
    )
    .addNode(
      "bash",
      middleware("bash", (state) => bashNode(state)),
    )
    .addNode("publish", middleware("publish", publishSummary))
    .addEdge(START, "initialize")
    .addEdge("initialize", "advance")
    .addConditionalEdges("advance", routeStep, {
      agent: "agent",
      bash: "bash",
      publish: "publish",
    })
    .addEdge("agent", "advance")
    .addEdge("bash", "advance")
    .addEdge("publish", END)
    .compile({ checkpointer });
}

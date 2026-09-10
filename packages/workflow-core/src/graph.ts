import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import { RunState } from "./state.js";
import { initializeRun } from "./nodes/initialize.js";
import { advanceWorkflow, routeStep } from "./nodes/advance.js";
import { agentNode } from "./nodes/agent.js";
import { bashNode } from "./nodes/bash.js";
import { publishSummary } from "./nodes/publish.js";

/**
 * Builds the reusable core LangGraph graph exactly as documented in INITIAL.md:
 * initialize -> advance -> {agent|bash|publish} -> advance (loop) -> publish -> END.
 */
export function buildGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(RunState)
    .addNode("initialize", initializeRun)
    .addNode("advance", advanceWorkflow)
    .addNode("agent", (state) => agentNode(state))
    .addNode("bash", (state) => bashNode(state))
    .addNode("publish", publishSummary)
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

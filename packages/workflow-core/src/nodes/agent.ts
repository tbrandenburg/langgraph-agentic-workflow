import type { AgentResult } from "@wf/agent-contracts";
import { assertAgentStep } from "../types.js";
import { addResult, selectResults, type RunStateType, type RunStateUpdate } from "../state.js";
import { loadProject } from "../registry.js";

/**
 * Signature `@wf/agent-runtime`'s M3 `runAgent` must satisfy. Defined here (dependency
 * inversion, per the M2 handoff decision) rather than imported from the still-stub
 * `@wf/agent-runtime` package, so `workflow-core` has no hard dependency on unimplemented M3
 * code. M3 should implement a function matching this signature and wire it in as the
 * `runAgent` parameter (or via `setDefaultAgentRunner`) instead of changing this contract.
 */
export interface RunAgentInput {
  promptFile: string;
  role: string;
  model: string;
  input: {
    run: RunStateType["run"];
    task: RunStateType["task"];
    upstream: ReturnType<typeof selectResults>;
    stepId: string;
  };
}

export type RunAgent = (input: RunAgentInput) => Promise<AgentResult>;

let defaultRunAgent: RunAgent | null = null;

/** Lets the host process (e.g. `scripts/run-local.ts`) inject the real/dry-run agent runner. */
export function setDefaultAgentRunner(runner: RunAgent): void {
  defaultRunAgent = runner;
}

/**
 * Core `agent` node: resolves the requested prompt via the project registry, validates it
 * against policy (registry.loadProject already enforces the whitelist at load time), and
 * delegates execution to the injected `runAgent` implementation.
 */
export async function agentNode(
  state: RunStateType,
  runAgent: RunAgent = mustGetDefaultRunner(),
): Promise<RunStateUpdate> {
  const step = assertAgentStep(state.currentStep);
  const project = await loadProject(state.run.projectId);

  if (!project.policy.prompts.includes(step.prompt)) {
    throw new Error(
      `Project "${state.run.projectId}": prompt "${step.prompt}" is not whitelisted in policy.prompts`,
    );
  }

  const priorAgentTurns = Object.values(state.results).filter(isAgentResult).length;
  if (priorAgentTurns >= project.policy.maxAgentTurns) {
    throw new Error(
      `Project "${state.run.projectId}": maxAgentTurns (${project.policy.maxAgentTurns}) exceeded before step "${step.id}"`,
    );
  }

  const result = await runAgent({
    promptFile: project.promptPath(step.prompt),
    role: step.prompt,
    model: state.run.model,
    input: {
      run: state.run,
      task: state.task,
      upstream: selectResults(state.results, step.inputs),
      stepId: step.id,
    },
  });

  return addResult(step.id, "agent", result);
}

function mustGetDefaultRunner(): RunAgent {
  if (!defaultRunAgent) {
    throw new Error(
      "No runAgent implementation configured. Call setDefaultAgentRunner() or pass one explicitly.",
    );
  }
  return defaultRunAgent;
}

function isAgentResult(result: RunStateType["results"][string]): result is AgentResult {
  return "role" in result && "artifacts" in result;
}

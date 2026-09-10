import type { WorkflowStep } from "../types.js";
import type { RunStateType, RunStateUpdate, StepResult } from "../state.js";

export type RouteTarget = "agent" | "bash" | "publish";

function previousStepFailedWithPublishGuard(state: RunStateType): boolean {
  const previous = state.workflow.steps[state.stepIndex - 1];
  if (!previous || previous.kind === "publish" || previous.onFailure !== "publish") {
    return false;
  }
  const result: StepResult | undefined = state.results[previous.id];
  return result ? !result.ok : false;
}

/**
 * Core `advance` node: selects `workflow.steps[stepIndex]` as the next step to run, unless the
 * previous step failed and declared `onFailure: "publish"`, in which case it jumps straight to
 * the publish step (skipping remaining steps).
 */
export function advanceWorkflow(state: RunStateType): RunStateUpdate {
  if (previousStepFailedWithPublishGuard(state)) {
    const publish = findPublishStep(state.workflow.steps);
    return { currentStep: publish };
  }

  const step = state.workflow.steps[state.stepIndex] ?? null;
  return {
    currentStep: step,
    stepIndex: state.stepIndex + (step ? 1 : 0),
  };
}

function findPublishStep(steps: WorkflowStep[]): WorkflowStep {
  const publish = steps.find((step) => step.kind === "publish");
  if (!publish) {
    throw new Error("Workflow definition is missing a publish step");
  }
  return publish;
}

/** Conditional edge router used with `addConditionalEdges("advance", routeStep, {...})`. */
export function routeStep(state: RunStateType): RouteTarget {
  if (!state.currentStep) {
    return "publish";
  }
  return state.currentStep.kind;
}

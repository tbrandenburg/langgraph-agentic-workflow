/** Public request/response shapes for the agent-service library API. */

export interface StartRunRequest {
  project: string;
  workflow: string;
  task: string;
  model: string;
}

export type RunSummaryStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface RunStepView {
  id: string;
  kind: "agent" | "bash" | "publish";
  ok: boolean | null;
}

export interface RunView {
  runId: string;
  status: RunSummaryStatus;
  stepIndex: number;
  steps: RunStepView[];
}

/** Thrown when the project/workflow pair cannot be resolved (zod already validated shape). */
export class UnknownProjectOrWorkflowError extends Error {}

/** Thrown when `MAX_CONCURRENT_RUNS` is reached. */
export class CapacityExceededError extends Error {}

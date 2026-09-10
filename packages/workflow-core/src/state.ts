import { Annotation } from "@langchain/langgraph";
import type { AgentResult, CommandResult } from "@wf/agent-contracts";
import type { WorkflowDefinition, WorkflowStep } from "./types.js";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type RunMode = "dry-run" | "live";

export interface RunManifest {
  id: string;
  projectId: string;
  workflowId: string;
  model: string;
  workspace: string;
  createdAt: string;
  mode: RunMode;
}

export interface TaskRequest {
  description: string;
}

export type StepResult = AgentResult | CommandResult;

export type ResultsMap = Record<string, StepResult>;

/** Merges new step results into the accumulated map. Never drops prior entries. */
export function mergeResults(current: ResultsMap, update: ResultsMap): ResultsMap {
  return { ...current, ...update };
}

export const RunState = Annotation.Root({
  run: Annotation<RunManifest>,
  workflow: Annotation<WorkflowDefinition>,
  task: Annotation<TaskRequest>,
  currentStep: Annotation<WorkflowStep | null>,
  stepIndex: Annotation<number>,
  results: Annotation<ResultsMap, ResultsMap>({
    reducer: mergeResults,
    default: () => ({}),
  }),
  status: Annotation<RunStatus>,
});

export type RunStateType = typeof RunState.State;
export type RunStateUpdate = typeof RunState.Update;

/** Selects results for the given step ids (used to build agent/bash node inputs). */
export function selectResults(results: ResultsMap, stepIds: string[]): ResultsMap {
  const selected: ResultsMap = {};
  for (const id of stepIds) {
    const result = results[id];
    if (result) {
      selected[id] = result;
    }
  }
  return selected;
}

/** Builds a state update that appends a single step result to `results`. */
export function addResult(
  stepId: string,
  _kind: "agent" | "bash",
  result: StepResult,
): RunStateUpdate {
  return { results: { [stepId]: result } };
}

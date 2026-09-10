import type { AgentResult, CommandResult } from "@wf/agent-contracts";

/**
 * `@wf/agent-runtime` intentionally does NOT depend on `@wf/workflow-core` (avoids a
 * backward/circular dependency: workflow-core's nodes call into agent-runtime, not the other
 * way around). These types are structurally identical to workflow-core's `RunManifest` /
 * `TaskRequest` / `ResultsMap` (see packages/workflow-core/src/state.ts) so that the
 * `runAgent`/`runScript` functions implemented here satisfy workflow-core's `RunAgent`/
 * `RunScript` signatures (packages/workflow-core/src/nodes/{agent,bash}.ts) purely by
 * structural typing when wired in via `setDefaultAgentRunner`/`setDefaultScriptRunner`.
 */
export interface RunManifestLike {
  id: string;
  projectId: string;
  workflowId: string;
  model: string;
  workspace: string;
  createdAt: string;
  mode: "dry-run" | "live";
}

export interface TaskRequestLike {
  description: string;
}

/** Deliberately loose (`unknown` values) so it accepts workflow-core's `ResultsMap`. */
export type ResultsMapLike = Record<string, unknown>;

export interface RunAgentInput {
  promptFile: string;
  role: string;
  model: string;
  input: {
    run: RunManifestLike;
    task: TaskRequestLike;
    upstream: ResultsMapLike;
    stepId: string;
  };
}

export type RunAgent = (input: RunAgentInput) => Promise<AgentResult>;

export interface RunScriptInput {
  path: string;
  workspace: string;
  input: ResultsMapLike;
  idempotencyKey: string;
  timeoutSeconds: number;
}

export type RunScript = (input: RunScriptInput) => Promise<CommandResult>;

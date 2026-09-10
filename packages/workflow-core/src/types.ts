// Core workflow types. No project content (prompt text, shell commands) lives here.

export type OnFailure = "publish";

export interface AgentStep {
  kind: "agent";
  id: string;
  prompt: string;
  inputs: string[];
  onFailure?: OnFailure;
}

export interface BashStep {
  kind: "bash";
  id: string;
  script: string;
  inputs: string[];
  onFailure?: OnFailure;
}

export interface PublishStep {
  kind: "publish";
  id: string;
}

export type WorkflowStep = AgentStep | BashStep | PublishStep;

export interface WorkflowDefinition {
  id: string;
  version: number;
  steps: WorkflowStep[];
}

export interface ProjectPolicy {
  prompts: string[];
  scripts: string[];
  workspacePaths: string[];
  maxAgentTurns: number;
  maxCommandSeconds: number;
  allowRepositoryWrite: boolean;
}

export interface AgentStepOptions {
  inputs?: string[];
  onFailure?: OnFailure;
}

export interface BashStepOptions {
  inputs?: string[];
  onFailure?: OnFailure;
}

export function defineWorkflow(def: WorkflowDefinition): WorkflowDefinition {
  return def;
}

export function agentStep(id: string, prompt: string, opts: AgentStepOptions = {}): AgentStep {
  return {
    kind: "agent",
    id,
    prompt,
    inputs: opts.inputs ?? [],
    ...(opts.onFailure ? { onFailure: opts.onFailure } : {}),
  };
}

export function bashStep(id: string, script: string, opts: BashStepOptions = {}): BashStep {
  return {
    kind: "bash",
    id,
    script,
    inputs: opts.inputs ?? [],
    ...(opts.onFailure ? { onFailure: opts.onFailure } : {}),
  };
}

export function publishStep(id: string): PublishStep {
  return { kind: "publish", id };
}

export function assertAgentStep(step: WorkflowStep | null): AgentStep {
  if (!step || step.kind !== "agent") {
    throw new Error(`Expected an agent step, got: ${step ? step.kind : "null"}`);
  }
  return step;
}

export function assertBashStep(step: WorkflowStep | null): BashStep {
  if (!step || step.kind !== "bash") {
    throw new Error(`Expected a bash step, got: ${step ? step.kind : "null"}`);
  }
  return step;
}

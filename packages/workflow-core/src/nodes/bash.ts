import type { CommandResult } from "@wf/agent-contracts";
import { resolve, sep } from "node:path";
import { assertBashStep } from "../types.js";
import { addResult, selectResults, type RunStateType, type RunStateUpdate } from "../state.js";
import { loadProject } from "../registry.js";

/**
 * Signature `@wf/agent-runtime`'s M3 `runScript` must satisfy (see nodes/agent.ts for the same
 * dependency-inversion rationale applied to `runAgent`).
 */
export interface RunScriptInput {
  path: string;
  workspace: string;
  input: ReturnType<typeof selectResults>;
  idempotencyKey: string;
  timeoutSeconds: number;
}

export type RunScript = (input: RunScriptInput) => Promise<CommandResult>;

let defaultRunScript: RunScript | null = null;

/** Lets the host process (e.g. `scripts/run-local.ts`) inject the real/dry-run script runner. */
export function setDefaultScriptRunner(runner: RunScript): void {
  defaultRunScript = runner;
}

/**
 * Core `bash` node: resolves the requested script via the project registry, validates it is
 * whitelisted and does not escape the project's scripts directory, and delegates execution to
 * the injected `runScript` implementation.
 */
export async function bashNode(
  state: RunStateType,
  runScript: RunScript = mustGetDefaultRunner(),
): Promise<RunStateUpdate> {
  const step = assertBashStep(state.currentStep);
  const project = await loadProject(state.run.projectId);

  if (!project.policy.scripts.includes(step.script)) {
    throw new Error(
      `Project "${state.run.projectId}": script "${step.script}" is not whitelisted in policy.scripts`,
    );
  }

  const scriptPath = project.scriptPath(step.script);
  assertWithinScriptsDir(state.run.projectId, project.dir, scriptPath);

  const result = await runScript({
    path: scriptPath,
    workspace: state.run.workspace,
    input: selectResults(state.results, step.inputs),
    idempotencyKey: `${state.run.id}:${step.id}`,
    timeoutSeconds: project.policy.maxCommandSeconds,
  });

  return addResult(step.id, "bash", result);
}

function assertWithinScriptsDir(projectId: string, projectDir: string, scriptPath: string): void {
  const scriptsDir = resolve(projectDir, "scripts");
  const resolvedPath = resolve(scriptPath);
  if (resolvedPath !== scriptsDir && !resolvedPath.startsWith(scriptsDir + sep)) {
    throw new Error(
      `Project "${projectId}": resolved script path escapes the project scripts directory`,
    );
  }
}

function mustGetDefaultRunner(): RunScript {
  if (!defaultRunScript) {
    throw new Error(
      "No runScript implementation configured. Call setDefaultScriptRunner() or pass one explicitly.",
    );
  }
  return defaultRunScript;
}

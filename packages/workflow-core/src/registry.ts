import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ProjectPolicy, WorkflowDefinition, WorkflowStep } from "./types.js";

export interface ProjectRegistryEntry {
  id: string;
  dir: string;
  workflow: WorkflowDefinition;
  policy: ProjectPolicy;
  promptPath: (name: string) => string;
  scriptPath: (name: string) => string;
}

const cache = new Map<string, ProjectRegistryEntry>();

/** Resolves the projects root: explicit arg > `WF_PROJECTS_ROOT` env var > `"projects"` (relative to cwd). */
function defaultProjectsRoot(): string {
  return process.env.WF_PROJECTS_ROOT ?? "projects";
}

/** Clears the in-process registry cache. Intended for tests. */
export function resetRegistryCache(): void {
  cache.clear();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads and validates a project's workflow + policy contract.
 * Throws a descriptive error (including the project id and the specific invalid reference) on
 * any violation, rather than returning a boolean. Fails at load time, not run time.
 */
export async function loadProject(
  projectId: string,
  projectsRoot: string = defaultProjectsRoot(),
): Promise<ProjectRegistryEntry> {
  const cached = cache.get(projectId);
  if (cached) {
    return cached;
  }

  const dir = resolve(projectsRoot, projectId);
  const workflowModule = (await import(resolve(dir, "workflow.ts"))) as {
    default: WorkflowDefinition;
  };
  const policyModule = (await import(resolve(dir, "policy.ts"))) as { policy: ProjectPolicy };

  const workflow = workflowModule.default;
  const policy = policyModule.policy;

  const promptsDir = resolve(dir, "prompts");
  const scriptsDir = resolve(dir, "scripts");

  await validateWorkflowAgainstPolicy(projectId, workflow, policy, promptsDir, scriptsDir);

  const entry: ProjectRegistryEntry = {
    id: projectId,
    dir,
    workflow,
    policy,
    promptPath: (name: string) => join(promptsDir, `${name}.md`),
    scriptPath: (name: string) => join(scriptsDir, `${name}.sh`),
  };

  cache.set(projectId, entry);
  return entry;
}

/** Discovers and loads every project under `projectsRoot`. Used by `registry.spec.ts`. */
export async function loadAllProjects(
  projectsRoot: string = defaultProjectsRoot(),
): Promise<ProjectRegistryEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true }).then((dirents) =>
      dirents.filter((d) => d.isDirectory()).map((d) => d.name),
    );
  } catch {
    return [];
  }

  const projects: ProjectRegistryEntry[] = [];
  for (const id of entries) {
    projects.push(await loadProject(id, projectsRoot));
  }
  return projects;
}

/**
 * Validates a workflow definition against its project policy and filesystem contents:
 * - every prompt referenced by an agent step exists on disk and is whitelisted in the policy;
 * - every script referenced by a bash step exists on disk, is whitelisted, and its resolved path
 *   does not escape the project's scripts directory;
 * - every step's `inputs[]` refers either to the literal `"task"` or to an earlier step id.
 */
export async function validateWorkflowAgainstPolicy(
  projectId: string,
  workflow: WorkflowDefinition,
  policy: ProjectPolicy,
  promptsDir: string,
  scriptsDir: string,
): Promise<void> {
  const seenStepIds = new Set<string>();

  for (const step of workflow.steps) {
    await validateStepInputs(projectId, step, seenStepIds);

    if (step.kind === "agent") {
      await validatePrompt(projectId, step.prompt, policy, promptsDir);
    }
    if (step.kind === "bash") {
      await validateScript(projectId, step.script, policy, scriptsDir);
    }

    seenStepIds.add(step.id);
  }
}

async function validateStepInputs(
  projectId: string,
  step: WorkflowStep,
  seenStepIds: Set<string>,
): Promise<void> {
  if (step.kind === "publish") {
    return;
  }
  for (const input of step.inputs) {
    if (input === "task") {
      continue;
    }
    if (input === step.id) {
      throw new Error(
        `Project "${projectId}": step "${step.id}" declares itself as an input (self-reference)`,
      );
    }
    if (!seenStepIds.has(input)) {
      throw new Error(
        `Project "${projectId}": step "${step.id}" references unknown or forward input "${input}"`,
      );
    }
  }
}

async function validatePrompt(
  projectId: string,
  prompt: string,
  policy: ProjectPolicy,
  promptsDir: string,
): Promise<void> {
  if (!policy.prompts.includes(prompt)) {
    throw new Error(
      `Project "${projectId}": prompt "${prompt}" is not whitelisted in policy.prompts`,
    );
  }
  const path = join(promptsDir, `${prompt}.md`);
  if (!(await pathExists(path))) {
    throw new Error(`Project "${projectId}": prompt "${prompt}" not found at ${path}`);
  }
}

async function validateScript(
  projectId: string,
  script: string,
  policy: ProjectPolicy,
  scriptsDir: string,
): Promise<void> {
  if (!policy.scripts.includes(script)) {
    throw new Error(
      `Project "${projectId}": script "${script}" is not whitelisted in policy.scripts`,
    );
  }
  const resolvedScriptsDir = resolve(scriptsDir);
  const path = resolve(scriptsDir, `${script}.sh`);
  if (path !== resolvedScriptsDir && !path.startsWith(resolvedScriptsDir + sep)) {
    throw new Error(
      `Project "${projectId}": script "${script}" resolves outside the project scripts directory`,
    );
  }
  if (!(await pathExists(path))) {
    throw new Error(`Project "${projectId}": script "${script}" not found at ${path}`);
  }
}

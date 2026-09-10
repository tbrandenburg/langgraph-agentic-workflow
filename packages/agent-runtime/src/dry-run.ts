import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { AgentResult } from "@wf/agent-contracts";
import { AgentResultSchema } from "@wf/agent-contracts";
import type { RunAgentInput } from "./types.js";

export interface DryRunOptions {
  /** Explicit project root, preferred over the `WF_PROJECTS_ROOT` env var (kept for CLI
   * simplicity / consistency with `@wf/workflow-core`'s registry convention). */
  projectsRoot?: string;
}

/**
 * The rate-limit escape hatch: when `AGENT_DRY_RUN=1` (or `--dry-run`), no `opencode` process is
 * spawned at all. Returns a deterministic stub `AgentResult`, or a project-supplied fixture file
 * verbatim if one exists at `projects/<id>/fixtures/<role>.json`.
 *
 * Determinism requirement (verified by an E2E gate): the same `{role, stepId, promptFile
 * content, inputs}` MUST produce a byte-identical result across repeated invocations.
 */
export async function dryRunAgent(
  input: RunAgentInput,
  options: DryRunOptions = {},
): Promise<AgentResult> {
  const projectsRoot = options.projectsRoot ?? process.env.WF_PROJECTS_ROOT ?? "projects";
  const fixture = await loadFixture(projectsRoot, input.input.run.projectId, input.role);
  if (fixture) {
    return fixture;
  }

  return synthesizeStub(input);
}

async function loadFixture(
  projectsRoot: string,
  projectId: string,
  role: string,
): Promise<AgentResult | null> {
  const fixturePath = join(projectsRoot, projectId, "fixtures", `${role}.json`);
  if (!(await pathExists(fixturePath))) {
    return null;
  }
  const raw = await readFile(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return AgentResultSchema.parse(parsed);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function synthesizeStub(input: RunAgentInput): Promise<AgentResult> {
  let promptContent = "";
  try {
    promptContent = await readFile(input.promptFile, "utf8");
  } catch {
    // Missing prompt file is still deterministic (hashes to the same empty-content digest).
  }

  const digestInput = JSON.stringify({
    role: input.role,
    stepId: input.input.stepId,
    promptContent,
    inputs: input.input.upstream,
  });
  const hash = createHash("sha256").update(digestInput).digest("hex").slice(0, 16);

  return {
    ok: true,
    role: input.role,
    stepId: input.input.stepId,
    summary: `[dry-run stub] role=${input.role} stepId=${input.input.stepId} hash=${hash}`,
    artifacts: [],
  };
}

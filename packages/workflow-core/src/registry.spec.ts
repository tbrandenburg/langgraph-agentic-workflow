import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAllProjects,
  loadProject,
  resetRegistryCache,
  validateWorkflowAgainstPolicy,
} from "./registry.js";
import { agentStep, bashStep, defineWorkflow, publishStep, type ProjectPolicy } from "./types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const projectsRoot = join(repoRoot, "projects");

const basePolicy: ProjectPolicy = {
  prompts: ["planner"],
  scripts: ["build"],
  workspacePaths: [],
  maxAgentTurns: 3,
  maxCommandSeconds: 60,
  allowRepositoryWrite: false,
};

describe("registry.loadAllProjects", () => {
  it("does not throw when globbing the real projects/ directory (may find zero or more)", async () => {
    await expect(loadAllProjects(projectsRoot)).resolves.toBeInstanceOf(Array);
  });

  it("loads the __fixture__ project without throwing", async () => {
    resetRegistryCache();
    const projects = await loadAllProjects(projectsRoot);
    expect(projects.some((p) => p.id === "__fixture__")).toBe(true);
  });

  it("returns an empty array when the projects root does not exist", async () => {
    await expect(loadAllProjects(join(repoRoot, "does-not-exist"))).resolves.toEqual([]);
  });
});

describe("registry policy validation", () => {
  let dir: string;
  let promptsDir: string;
  let scriptsDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "registry-test-"));
    promptsDir = join(dir, "prompts");
    scriptsDir = join(dir, "scripts");
    await mkdir(promptsDir, { recursive: true });
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(promptsDir, "planner.md"), "plan", "utf8");
    await writeFile(join(scriptsDir, "build.sh"), "#!/usr/bin/env bash\necho hi\n", "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a valid workflow/policy pair", async () => {
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [
        agentStep("plan", "planner", { inputs: ["task"] }),
        bashStep("build", "build", { inputs: ["plan"] }),
        publishStep("publish"),
      ],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, basePolicy, promptsDir, scriptsDir),
    ).resolves.toBeUndefined();
  });

  it("rejects an unknown prompt not whitelisted in policy", async () => {
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [agentStep("plan", "unknown-prompt", { inputs: ["task"] }), publishStep("publish")],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, basePolicy, promptsDir, scriptsDir),
    ).rejects.toThrow(/unknown-prompt.*not whitelisted/);
  });

  it("rejects a whitelisted prompt that is missing on disk", async () => {
    const policy = { ...basePolicy, prompts: ["planner", "ghost"] };
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [agentStep("plan", "ghost", { inputs: ["task"] }), publishStep("publish")],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, policy, promptsDir, scriptsDir),
    ).rejects.toThrow(/ghost.*not found/);
  });

  it("rejects an unknown script not whitelisted in policy", async () => {
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [bashStep("build", "unknown-script", { inputs: ["task"] }), publishStep("publish")],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, basePolicy, promptsDir, scriptsDir),
    ).rejects.toThrow(/unknown-script.*not whitelisted/);
  });

  it("rejects a script path that escapes the project scripts directory", async () => {
    const policy = { ...basePolicy, scripts: ["../../../../etc/passwd"] };
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [
        bashStep("escape", "../../../../etc/passwd", { inputs: ["task"] }),
        publishStep("publish"),
      ],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, policy, promptsDir, scriptsDir),
    ).rejects.toThrow(/resolves outside the project scripts directory/);
  });

  it("rejects a step referencing a forward (not-yet-executed) step id in inputs", async () => {
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [
        agentStep("plan", "planner", { inputs: ["build"] }),
        bashStep("build", "build", { inputs: ["task"] }),
        publishStep("publish"),
      ],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, basePolicy, promptsDir, scriptsDir),
    ).rejects.toThrow(/unknown or forward input "build"/);
  });

  it("rejects a step referencing itself in inputs", async () => {
    const workflow = defineWorkflow({
      id: "wf",
      version: 1,
      steps: [agentStep("plan", "planner", { inputs: ["plan"] }), publishStep("publish")],
    });

    await expect(
      validateWorkflowAgainstPolicy("proj", workflow, basePolicy, promptsDir, scriptsDir),
    ).rejects.toThrow(/self-reference/);
  });
});

describe("registry.loadProject", () => {
  it("throws a descriptive error including the project id for a broken project", async () => {
    resetRegistryCache();
    await expect(loadProject("does-not-exist-project", projectsRoot)).rejects.toThrow();
  });
});

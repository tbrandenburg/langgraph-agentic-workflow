import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentResult } from "@wf/agent-contracts";
import { dryRunAgent } from "./dry-run.js";
import type { RunAgentInput } from "./types.js";

describe("dryRunAgent", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "dry-run-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function baseInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
    return {
      promptFile: join(workDir, "planner.md"),
      role: "planner",
      model: "opencode/big-pickle",
      input: {
        run: {
          id: "run-1",
          projectId: "demo",
          workflowId: "wf-1",
          model: "opencode/big-pickle",
          workspace: workDir,
          createdAt: new Date().toISOString(),
          mode: "dry-run",
        },
        task: { description: "smoke" },
        upstream: {},
        stepId: "plan",
      },
      ...overrides,
    };
  }

  it("produces a byte-identical stub across repeated invocations with the same inputs", async () => {
    await writeFile(join(workDir, "planner.md"), "You are the planner.", "utf8");
    const input = baseInput();

    const first = await dryRunAgent(input);
    const second = await dryRunAgent(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.ok).toBe(true);
  });

  it("produces a different stub when the prompt content differs", async () => {
    await writeFile(join(workDir, "planner.md"), "prompt A", "utf8");
    const resultA = await dryRunAgent(baseInput());

    await writeFile(join(workDir, "planner.md"), "prompt B", "utf8");
    const resultB = await dryRunAgent(baseInput());

    expect(resultA.summary).not.toBe(resultB.summary);
  });

  it("returns a fixture file verbatim when one exists for the role", async () => {
    const projectDir = join(workDir, "projects", "demo");
    const fixturesDir = join(projectDir, "fixtures");
    await mkdir(fixturesDir, { recursive: true });

    const fixture: AgentResult = {
      ok: true,
      role: "planner",
      stepId: "plan",
      summary: "fixture summary",
      artifacts: [],
    };
    await writeFile(join(fixturesDir, "planner.json"), JSON.stringify(fixture), "utf8");

    const result = await dryRunAgent(baseInput(), {
      projectsRoot: join(workDir, "projects"),
    });

    expect(result).toEqual(fixture);
  });
});

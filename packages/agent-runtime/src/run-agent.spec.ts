import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "./run-agent.js";
import type { RunAgentInput } from "./types.js";

/**
 * These tests exercise `runAgent` against a fake `opencode`-shaped script (not the real
 * `opencode` binary) so they run offline/deterministically. `bin` is overridable for exactly
 * this reason.
 */
describe("runAgent", () => {
  let workDir: string;
  let runsRoot: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "run-agent-test-"));
    runsRoot = await mkdtemp(join(tmpdir(), "run-agent-runs-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(runsRoot, { recursive: true, force: true });
  });

  async function fakeOpencode(name: string, script: string): Promise<string> {
    const path = join(workDir, name);
    await writeFile(path, `#!/usr/bin/env bash\n${script}`, "utf8");
    await chmod(path, 0o755);
    return path;
  }

  function baseInput(promptFile: string): RunAgentInput {
    return {
      promptFile,
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
          mode: "live",
        },
        task: { description: "smoke" },
        upstream: {},
        stepId: "plan",
      },
    };
  }

  it("returns ok:true with the summary from the last text run before a stop step_finish", async () => {
    const promptFile = join(workDir, "planner.md");
    await writeFile(promptFile, "prompt", "utf8");
    const bin = await fakeOpencode(
      "fake-ok.sh",
      [
        'echo \'{"type":"text","part":{"text":"Plan: "}}\'',
        'echo \'{"type":"text","part":{"text":"do the thing."}}\'',
        'echo \'{"type":"step_finish","part":{"reason":"stop"}}\'',
        "exit 0",
      ].join("\n"),
    );

    const result = await runAgent(baseInput(promptFile), { bin, runsRoot });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Plan: do the thing.");
  });

  it("returns ok:false when an error event is present even with exit code 0", async () => {
    const promptFile = join(workDir, "planner.md");
    await writeFile(promptFile, "prompt", "utf8");
    const bin = await fakeOpencode(
      "fake-error.sh",
      [
        'echo \'{"type":"error","error":{"name":"ProviderError","data":{"message":"rate limited"}}}\'',
        "exit 0",
      ].join("\n"),
    );

    const result = await runAgent(baseInput(promptFile), { bin, runsRoot });

    expect(result.ok).toBe(false);
    expect(result.error?.name).toBe("ProviderError");
    expect(result.artifacts).toHaveLength(1);
  });

  it("returns ok:false when the process exits non-zero", async () => {
    const promptFile = join(workDir, "planner.md");
    await writeFile(promptFile, "prompt", "utf8");
    const bin = await fakeOpencode("fake-fail.sh", "exit 1\n");

    const result = await runAgent(baseInput(promptFile), { bin, runsRoot });

    expect(result.ok).toBe(false);
  });

  it("never throws on malformed output and keeps the raw capture as an artifact", async () => {
    const promptFile = join(workDir, "planner.md");
    await writeFile(promptFile, "prompt", "utf8");
    const bin = await fakeOpencode("fake-garbage.sh", "echo 'not json at all'\nexit 0\n");

    const result = await runAgent(baseInput(promptFile), { bin, runsRoot });

    expect(result.ok).toBe(false);
    expect(result.artifacts[0]?.kind).toBe("log");
  });

  it("returns ok:false without throwing when the prompt file does not exist", async () => {
    const result = await runAgent(baseInput(join(workDir, "missing.md")), {
      bin: "opencode",
      runsRoot,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.name).toBe("prompt-read-failed");
  });
});

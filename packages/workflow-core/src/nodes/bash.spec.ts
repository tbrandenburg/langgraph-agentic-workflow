import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { CommandResult } from "@wf/agent-contracts";
import { bashNode, type RunScriptInput } from "./bash.js";
import type { RunStateType } from "../state.js";
import { resetRegistryCache } from "../registry.js";

beforeAll(() => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  process.env.WF_PROJECTS_ROOT = join(repoRoot, "projects");
});

function baseState(overrides: Partial<RunStateType> = {}): RunStateType {
  return {
    run: {
      id: "run-1",
      projectId: "__fixture__",
      workflowId: "fixture-smoke",
      model: "opencode/big-pickle",
      workspace: "/tmp/ws",
      createdAt: new Date().toISOString(),
      mode: "dry-run",
    },
    workflow: { id: "fixture-smoke", version: 1, steps: [] },
    task: { description: "smoke" },
    currentStep: { kind: "bash", id: "echo", script: "echo", inputs: ["task"] },
    stepIndex: 1,
    results: {},
    status: "running",
    ...overrides,
  };
}

const artifactRef = {
  id: "11111111-1111-1111-1111-111111111111",
  stepId: "echo",
  kind: "stdout" as const,
  path: "/tmp/x",
  bytes: 0,
  sha256: "0".repeat(64),
};

function okCommandResult(): CommandResult {
  return {
    ok: true,
    exitCode: 0,
    durationMs: 1,
    stdoutArtifact: artifactRef,
    stderrArtifact: { ...artifactRef, kind: "stderr" },
    truncated: false,
  };
}

describe("bashNode policy enforcement", () => {
  it("rejects a script not whitelisted by the project policy", async () => {
    resetRegistryCache();
    const state = baseState({
      currentStep: { kind: "bash", id: "s", script: "not-whitelisted", inputs: ["task"] },
    });

    await expect(bashNode(state, async () => okCommandResult())).rejects.toThrow(/not whitelisted/);
  });

  it("passes the configured maxCommandSeconds through as the timeout", async () => {
    resetRegistryCache();
    const state = baseState();
    let received: RunScriptInput | undefined;

    await bashNode(state, async (input) => {
      received = input;
      return okCommandResult();
    });

    expect(received?.timeoutSeconds).toBe(30); // __fixture__ policy.maxCommandSeconds
  });

  it("plumbs through the idempotency key and workspace", async () => {
    resetRegistryCache();
    const state = baseState();
    let received: RunScriptInput | undefined;

    await bashNode(state, async (input) => {
      received = input;
      return okCommandResult();
    });

    expect(received?.idempotencyKey).toBe("run-1:echo");
    expect(received?.workspace).toBe("/tmp/ws");
  });

  it("plumbs through the truncated flag from the command result unchanged", async () => {
    resetRegistryCache();
    const state = baseState();

    const update = await bashNode(state, async () => ({
      ...okCommandResult(),
      truncated: true,
    }));

    expect((update.results as Record<string, CommandResult> | undefined)?.echo?.truncated).toBe(
      true,
    );
  });
});

describe("bashNode path traversal protection", () => {
  it("throws when a script's resolved path escapes the project scripts directory", async () => {
    resetRegistryCache();
    // Simulate a compromised/misconfigured registry entry by pointing scriptPath outside the
    // project dir: exercised via a policy that whitelists a traversal-style script id whose
    // resolved path escapes scripts/. registry.ts already rejects this at load time (see
    // registry.spec.ts); this test targets the node-level defense-in-depth check directly.
    const state = baseState({
      currentStep: { kind: "bash", id: "s", script: "../../../../etc/passwd", inputs: ["task"] },
    });

    await expect(bashNode(state, async () => okCommandResult())).rejects.toThrow(
      /not whitelisted|resolves outside/,
    );
  });
});

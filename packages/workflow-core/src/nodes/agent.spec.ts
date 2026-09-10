import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { AgentResult } from "@wf/agent-contracts";
import { agentNode, type RunAgentInput } from "./agent.js";
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
    currentStep: { kind: "agent", id: "plan", prompt: "planner", inputs: ["task"] },
    stepIndex: 1,
    results: {},
    status: "running",
    ...overrides,
  };
}

function okAgentResult(stepId: string): AgentResult {
  return { ok: true, role: "planner", stepId, summary: "done", artifacts: [] };
}

describe("agentNode policy enforcement", () => {
  it("rejects a prompt not whitelisted by the project policy", async () => {
    resetRegistryCache();
    const state = baseState({
      currentStep: { kind: "agent", id: "plan", prompt: "not-whitelisted", inputs: ["task"] },
    });

    await expect(agentNode(state, async (i) => okAgentResult(i.input.stepId))).rejects.toThrow(
      /not whitelisted/,
    );
  });

  it("enforces maxAgentTurns by rejecting once the limit is reached", async () => {
    resetRegistryCache();
    // __fixture__ policy has maxAgentTurns: 1 and no whitelisted prompts, so use a state that
    // already has 1 prior agent result recorded to exercise the turn-count check directly.
    const state = baseState({
      currentStep: { kind: "agent", id: "plan2", prompt: "planner", inputs: ["task"] },
      results: { plan1: okAgentResult("plan1") },
    });

    await expect(agentNode(state, async (i) => okAgentResult(i.input.stepId))).rejects.toThrow(
      /maxAgentTurns/,
    );
  });

  it("invokes the injected runAgent with the resolved prompt path and passes upstream inputs", async () => {
    resetRegistryCache();
    const state = baseState({
      currentStep: { kind: "agent", id: "plan", prompt: "planner", inputs: ["task"] },
    });
    let received: RunAgentInput | undefined;

    const update = await agentNode(state, async (input) => {
      received = input;
      return okAgentResult(input.input.stepId);
    });

    expect(received?.role).toBe("planner");
    expect(received?.promptFile).toMatch(/planner\.md$/);
    expect(received?.input.stepId).toBe("plan");
    expect((update.results as Record<string, AgentResult>).plan?.ok).toBe(true);
  });
});

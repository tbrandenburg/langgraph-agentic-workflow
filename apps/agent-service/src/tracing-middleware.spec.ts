import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunStateType } from "@wf/workflow-core";
import { MetricsRegistry } from "./metrics.js";
import { readTrace, TraceWriter } from "./trace-store.js";
import { createTracingMiddleware } from "./tracing-middleware.js";

let runsRoot: string;

beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), "tracing-middleware-test-"));
});

afterEach(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

function baseState(overrides: Partial<RunStateType> = {}): RunStateType {
  return {
    run: {
      id: "run-1",
      projectId: "example-service",
      workflowId: "wf-1",
      model: "opencode/big-pickle",
      workspace: "/tmp/ws",
      createdAt: new Date().toISOString(),
      mode: "dry-run",
    },
    workflow: { id: "wf-1", version: 1, steps: [] },
    task: { description: "smoke" },
    currentStep: { kind: "agent", id: "plan", prompt: "planner", inputs: ["task"] },
    stepIndex: 1,
    results: {},
    status: "running",
    ...overrides,
  };
}

describe("createTracingMiddleware", () => {
  it("emits a start and an end event with a positive durationMs and ok derived from the result", async () => {
    const writer = new TraceWriter(runsRoot);
    const metrics = new MetricsRegistry();
    const middleware = createTracingMiddleware(writer, metrics);

    const wrapped = middleware("agent", async () => ({
      results: {
        plan: { ok: true, role: "planner", stepId: "plan", summary: "ok", artifacts: [] },
      },
    }));

    await wrapped(baseState());

    const events = await readTrace("run-1", runsRoot);
    expect(events).toHaveLength(2);
    expect(events?.[0]).toMatchObject({ phase: "start", nodeName: "agent", stepId: "plan" });
    expect(events?.[1]).toMatchObject({
      phase: "end",
      nodeName: "agent",
      stepId: "plan",
      ok: true,
    });
    expect(events?.[1]?.durationMs).toBeGreaterThanOrEqual(0);

    const snapshot = metrics.snapshot();
    expect(snapshot.steps.find((s) => s.kind === "agent")?.count).toBe(1);
  });

  it("records ok:false and re-throws when the wrapped node throws", async () => {
    const writer = new TraceWriter(runsRoot);
    const metrics = new MetricsRegistry();
    const middleware = createTracingMiddleware(writer, metrics);

    const wrapped = middleware("bash", async () => {
      throw new Error("boom");
    });

    await expect(
      wrapped(
        baseState({ currentStep: { kind: "bash", id: "build", script: "x.sh", inputs: [] } }),
      ),
    ).rejects.toThrow("boom");

    const events = await readTrace("run-1", runsRoot);
    expect(events).toHaveLength(2);
    expect(events?.[1]).toMatchObject({
      phase: "end",
      ok: false,
      nodeName: "bash",
      stepId: "build",
    });
  });

  it("marks publish ok:false when the final status is failed", async () => {
    const writer = new TraceWriter(runsRoot);
    const metrics = new MetricsRegistry();
    const middleware = createTracingMiddleware(writer, metrics);

    const wrapped = middleware("publish", async () => ({ status: "failed" as const }));
    await wrapped(baseState({ currentStep: null }));

    const events = await readTrace("run-1", runsRoot);
    expect(events?.[1]).toMatchObject({
      phase: "end",
      nodeName: "publish",
      ok: false,
      stepId: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.js";

describe("MetricsRegistry", () => {
  it("counts run lifecycle transitions", () => {
    const metrics = new MetricsRegistry();
    metrics.recordRunStarted();
    metrics.recordRunStarted();
    metrics.recordRunFinished("succeeded");
    metrics.recordRunFinished("failed");
    metrics.recordRunFinished("cancelled");

    const snapshot = metrics.snapshot();
    expect(snapshot.runs_started_total).toBe(2);
    expect(snapshot.runs_succeeded_total).toBe(1);
    expect(snapshot.runs_failed_total).toBe(1);
    expect(snapshot.runs_cancelled_total).toBe(1);
  });

  it("aggregates step durations by kind with a computed average", () => {
    const metrics = new MetricsRegistry();
    metrics.recordStepDuration("agent", 100);
    metrics.recordStepDuration("agent", 300);
    metrics.recordStepDuration("bash", 50);

    const snapshot = metrics.snapshot();
    const agent = snapshot.steps.find((s) => s.kind === "agent");
    const bash = snapshot.steps.find((s) => s.kind === "bash");

    expect(agent).toEqual({ kind: "agent", count: 2, totalDurationMs: 400, avgDurationMs: 200 });
    expect(bash).toEqual({ kind: "bash", count: 1, totalDurationMs: 50, avgDurationMs: 50 });
  });

  it("reports zero avgDurationMs for a kind with no recorded steps", () => {
    const metrics = new MetricsRegistry();
    const bash = metrics.snapshot().steps.find((s) => s.kind === "bash");
    expect(bash).toEqual({ kind: "bash", count: 0, totalDurationMs: 0, avgDurationMs: 0 });
  });
});

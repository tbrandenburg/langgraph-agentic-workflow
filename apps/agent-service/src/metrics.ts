/**
 * Modified-M6 metrics: real in-memory counters replacing the M5 `/metrics` stub. Substitutes for
 * a real Prometheus exposition format — a JSON object of counters is an acceptable PoC-scoped
 * substitute per the M6 handoff (documented choice: JSON, not Prometheus text, to keep this a
 * ~10-minute addition rather than pulling in a Prometheus client library).
 *
 * The step-duration "histogram" is likewise simplified to a per-kind
 * `{count, totalDurationMs, avgDurationMs}` rollup rather than real histogram buckets — a real
 * histogram is overkill for a PoC-scoped in-memory registry.
 */
export type StepKind = "agent" | "bash";

interface StepAggregate {
  count: number;
  totalDurationMs: number;
}

export interface MetricsSnapshot {
  runs_started_total: number;
  runs_succeeded_total: number;
  runs_failed_total: number;
  runs_cancelled_total: number;
  steps: { kind: StepKind; count: number; totalDurationMs: number; avgDurationMs: number }[];
}

export class MetricsRegistry {
  private started = 0;
  private succeeded = 0;
  private failed = 0;
  private cancelled = 0;
  private readonly steps: Record<StepKind, StepAggregate> = {
    agent: { count: 0, totalDurationMs: 0 },
    bash: { count: 0, totalDurationMs: 0 },
  };

  recordRunStarted(): void {
    this.started += 1;
  }

  recordRunFinished(status: "succeeded" | "failed" | "cancelled"): void {
    if (status === "succeeded") {
      this.succeeded += 1;
    } else if (status === "cancelled") {
      this.cancelled += 1;
    } else {
      this.failed += 1;
    }
  }

  recordStepDuration(kind: StepKind, durationMs: number): void {
    const aggregate = this.steps[kind];
    aggregate.count += 1;
    aggregate.totalDurationMs += durationMs;
  }

  snapshot(): MetricsSnapshot {
    return {
      runs_started_total: this.started,
      runs_succeeded_total: this.succeeded,
      runs_failed_total: this.failed,
      runs_cancelled_total: this.cancelled,
      steps: (Object.keys(this.steps) as StepKind[]).map((kind) => {
        const aggregate = this.steps[kind];
        return {
          kind,
          count: aggregate.count,
          totalDurationMs: aggregate.totalDurationMs,
          avgDurationMs: aggregate.count > 0 ? aggregate.totalDurationMs / aggregate.count : 0,
        };
      }),
    };
  }
}

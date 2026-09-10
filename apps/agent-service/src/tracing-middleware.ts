import type {
  NodeMiddleware,
  NodeName,
  ResultsMap,
  RunStateType,
  RunStateUpdate,
} from "@wf/workflow-core";
import type { MetricsRegistry, StepKind } from "./metrics.js";
import { TraceWriter } from "./trace-store.js";

/**
 * Builds the `NodeMiddleware` injected into `buildGraph()`. Wraps every node call with a
 * start/end JSONL trace event (written via `TraceWriter`) and feeds `agent`/`bash` step
 * durations into `MetricsRegistry` for the `/metrics` step-duration breakdown. Kept out of
 * `packages/workflow-core` per the plan's "core contains zero project content" spirit — this is
 * the app-level piece that decides *what* to do with the generic hook.
 */
export function createTracingMiddleware(
  writer: TraceWriter,
  metrics: MetricsRegistry,
): NodeMiddleware {
  return (nodeName, fn) => async (state) => {
    const base = baseFields(state, nodeName);
    const startedAt = Date.now();
    await writer.append({ ...base, phase: "start", timestampMs: startedAt });

    try {
      const update = await fn(state);
      const endedAt = Date.now();
      const durationMs = endedAt - startedAt;
      const ok = determineOk(nodeName, state, update);
      const endEvent =
        ok === undefined
          ? { ...base, phase: "end" as const, timestampMs: endedAt, durationMs }
          : { ...base, phase: "end" as const, timestampMs: endedAt, durationMs, ok };
      await writer.append(endEvent);
      if (isStepKind(nodeName)) {
        metrics.recordStepDuration(nodeName, durationMs);
      }
      return update;
    } catch (error) {
      const endedAt = Date.now();
      await writer.append({
        ...base,
        phase: "end",
        timestampMs: endedAt,
        durationMs: endedAt - startedAt,
        ok: false,
      });
      throw error;
    }
  };
}

function baseFields(state: RunStateType, nodeName: NodeName) {
  return {
    runId: state.run.id,
    projectId: state.run.projectId,
    workflowId: state.run.workflowId,
    mode: state.run.mode,
    nodeName,
    stepId: state.currentStep?.id ?? null,
  };
}

function determineOk(
  nodeName: NodeName,
  state: RunStateType,
  update: RunStateUpdate,
): boolean | undefined {
  if (nodeName === "agent" || nodeName === "bash") {
    const stepId = state.currentStep?.id;
    if (!stepId) {
      return undefined;
    }
    const results = (update.results ?? {}) as ResultsMap;
    const result = results[stepId];
    return result ? result.ok : undefined;
  }
  if (nodeName === "publish") {
    return update.status !== "failed";
  }
  return true;
}

function isStepKind(nodeName: NodeName): nodeName is StepKind {
  return nodeName === "agent" || nodeName === "bash";
}

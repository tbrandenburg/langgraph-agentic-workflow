import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGraph,
  createCheckpointer,
  loadProject,
  resetRegistryCache,
  setDefaultAgentRunner,
  setDefaultScriptRunner,
  threadIdForRun,
  type RunAgent,
  type RunScript,
  type RunStateType,
} from "@wf/workflow-core";
import { createTracingMiddleware } from "./tracing-middleware.js";
import { MetricsRegistry } from "./metrics.js";
import { TraceWriter } from "./trace-store.js";

/**
 * Throwaway integration test for the M6 checklist item "`validate.sh` failure demonstrably
 * skipped the downstream agent step". Rather than mutating the real `projects/example-service`
 * fixture on disk (which the assigned-step instructions say to avoid), this test loads the real
 * `example-service` workflow/policy (structural, read-only) and injects a fake `runScript` that
 * fails only the `validate` step's `CommandResult`. This proves the failure-routing behavior
 * (`onFailure: "publish"` jump, skipping `review`/`package`) without ever writing to
 * `projects/example-service/scripts/validate.sh` or the target sample repo.
 */
describe("validate step failure routes to publish and skips downstream steps", () => {
  beforeAll(() => {
    resetRegistryCache();
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    process.env.WF_PROJECTS_ROOT = join(repoRoot, "projects");
  });

  const runId = `validate-failure-test-run-${randomUUID()}`;

  afterAll(async () => {
    await rm(".runs-test-validate-failure", { recursive: true, force: true });
    // `nodes/publish.ts` writes via the default `ArtifactStore` root (`.runs/<runId>/...`),
    // separate from the custom trace-only root above — both must be cleaned up, or a
    // write-once violation occurs on any re-run reusing the same runId.
    await rm(join(".runs", runId), { recursive: true, force: true });
  });

  it("does not run review/package after validate fails, and reaches publish directly", async () => {
    const fakeAgentRunner: RunAgent = async (input) => ({
      ok: true,
      role: input.role,
      stepId: input.input.stepId,
      summary: "stub",
      artifacts: [],
    });

    const fakeScriptRunner: RunScript = async (input) => {
      const stepId = input.idempotencyKey.split(":")[1] ?? "unknown";
      const failed = stepId === "validate";
      return {
        ok: !failed,
        exitCode: failed ? 3 : 0,
        durationMs: 1,
        stdoutArtifact: {
          id: randomUUID(),
          stepId,
          kind: "stdout",
          path: "/dev/null",
          bytes: 0,
          sha256: "0".repeat(64),
        },
        stderrArtifact: {
          id: randomUUID(),
          stepId,
          kind: "stderr",
          path: "/dev/null",
          bytes: 0,
          sha256: "0".repeat(64),
        },
        truncated: false,
      };
    };

    setDefaultAgentRunner(fakeAgentRunner);
    setDefaultScriptRunner(fakeScriptRunner);

    const project = await loadProject("example-service");
    const checkpointer = await createCheckpointer();
    const traceWriter = new TraceWriter(".runs-test-validate-failure");
    const metrics = new MetricsRegistry();
    const graph = buildGraph(checkpointer, createTracingMiddleware(traceWriter, metrics));

    const initialState: RunStateType = {
      run: {
        id: runId,
        projectId: "example-service",
        workflowId: project.workflow.id,
        model: "opencode/big-pickle",
        workspace: "",
        createdAt: "",
        mode: "dry-run",
      },
      workflow: project.workflow,
      task: { description: "throwaway validate-failure test" },
      currentStep: null,
      stepIndex: 0,
      results: {},
      status: "running",
    };

    const final = await graph.invoke(initialState, {
      configurable: { thread_id: threadIdForRun(runId) },
    });

    expect(final.status).toBe("failed");
    expect(final.results.validate?.ok).toBe(false);
    expect(final.results["apply-patch"]?.ok).toBe(true);
    expect(final.results.review).toBeUndefined();
    expect(final.results.package).toBeUndefined();

    const traceEvents = await import("./trace-store.js").then((m) =>
      m.readTrace(runId, ".runs-test-validate-failure"),
    );
    const nodeNamesWithStepIds = (traceEvents ?? [])
      .filter((e) => e.phase === "end")
      .map((e) => `${e.nodeName}:${e.stepId ?? ""}`);
    expect(nodeNamesWithStepIds).toContain("bash:validate");
    expect(nodeNamesWithStepIds).not.toContain("agent:review");
    expect(nodeNamesWithStepIds).not.toContain("bash:package");
    expect(nodeNamesWithStepIds).toContain("publish:publish");
  });
});

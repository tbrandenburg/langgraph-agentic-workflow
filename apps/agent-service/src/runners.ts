import { dryRunAgent, runAgent, runScript } from "@wf/agent-runtime";
import type { RunAgent, RunScript } from "@wf/workflow-core";
import { CancellationRegistry } from "./cancellation.js";

const isDryRunMode = process.env.AGENT_DRY_RUN === "1";

/**
 * Builds the `runAgent` implementation for `setDefaultAgentRunner`. Mirrors `scripts/run-local.ts`
 * (real vs. dry-run switch on `AGENT_DRY_RUN`), additionally forwarding the run's `AbortSignal`
 * (looked up by `input.input.run.id`) to the real `@wf/agent-runtime` `runAgent`'s `cancelSignal`
 * option, so `POST /runs/:runId/cancel` group-kills any spawned `opencode` child process.
 */
export function buildAgentRunner(cancellation: CancellationRegistry): RunAgent {
  return async (input) => {
    if (isDryRunMode) {
      return dryRunAgent(input);
    }
    const cancelSignal = cancellation.signalFor(input.input.run.id);
    return runAgent(input, cancelSignal !== undefined ? { cancelSignal } : {});
  };
}

/**
 * Builds the `runScript` implementation for `setDefaultScriptRunner`. Dry-run stays fully offline
 * (no process spawned), matching `scripts/run-local.ts`'s bash stub. Live mode forwards the run's
 * `AbortSignal` (parsed from `idempotencyKey`'s `<runId>:<stepId>` prefix) to `runScript`.
 */
export function buildScriptRunner(cancellation: CancellationRegistry): RunScript {
  return async (input) => {
    if (!isDryRunMode) {
      const runId = input.idempotencyKey.split(":")[0] ?? "";
      const cancelSignal = cancellation.signalFor(runId);
      return runScript(input, cancelSignal !== undefined ? { cancelSignal } : {});
    }
    return dryRunScriptStub(input);
  };
}

async function dryRunScriptStub(input: Parameters<RunScript>[0]): ReturnType<RunScript> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256")
    .update(JSON.stringify({ path: input.path }))
    .digest("hex");
  const stepId = input.idempotencyKey.split(":")[1] ?? "unknown";
  const artifact = {
    id: crypto.randomUUID(),
    stepId,
    kind: "stdout" as const,
    path: input.path,
    bytes: hash.length,
    sha256: hash,
  };
  return {
    ok: true,
    exitCode: 0,
    durationMs: 1,
    stdoutArtifact: artifact,
    stderrArtifact: { ...artifact, kind: "stderr" as const },
    truncated: false,
  };
}

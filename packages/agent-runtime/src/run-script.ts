import type { CommandResult } from "@wf/agent-contracts";
import { execa } from "execa";
import { restrictedEnv } from "./env.js";
import { writeRawArtifact } from "./artifact-writer.js";
import type { RunScriptInput } from "./types.js";

/** Conventional timeout exit code (matches `bash`/POSIX convention for SIGTERM-on-timeout). */
const TIMEOUT_EXIT_CODE = 124;

/** Defensive byte cap on captured stdout/stderr, to bound memory. */
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export interface RunScriptOptions {
  cancelSignal?: AbortSignal;
  runId?: string;
  runsRoot?: string;
}

/**
 * Real `@wf/agent-runtime` implementation of workflow-core's `RunScript` signature. Runs
 * `bash -euo pipefail <script>` inside the ephemeral workspace (cwd-jailed), group-killing the
 * whole process tree on timeout/cancellation via `killDescendants` + `cancelSignal`.
 *
 * NOTE (code-review concern, not enforced here): scripts must not background their own children
 * (`&`, `nohup`) — that escapes this process's group and defeats group-kill on timeout/cancel.
 */
export async function runScript(
  input: RunScriptInput,
  options: RunScriptOptions = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  const runId = options.runId ?? input.idempotencyKey.split(":")[0] ?? "unknown-run";
  const stepId = input.idempotencyKey.split(":")[1] ?? "unknown-step";

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), input.timeoutSeconds * 1000).unref();

  const combinedSignal = options.cancelSignal
    ? anySignal([options.cancelSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const result = await execa("bash", ["-euo", "pipefail", input.path], {
      cwd: input.workspace,
      env: restrictedEnv({
        IDEMPOTENCY_KEY: input.idempotencyKey,
      }),
      killDescendants: true,
      cancelSignal: combinedSignal,
      reject: false,
    });

    const durationMs = Date.now() - startedAt;
    const stdout = capBytes(result.stdout ?? "", MAX_CAPTURE_BYTES);
    const stderr = capBytes(result.stderr ?? "", MAX_CAPTURE_BYTES);
    const timedOut = timeoutController.signal.aborted;
    const exitCode = timedOut ? TIMEOUT_EXIT_CODE : (result.exitCode ?? -1);

    const [stdoutArtifact, stderrArtifact] = await Promise.all([
      writeRawArtifact(runId, stepId, "stdout.log", "stdout", stdout.content, options.runsRoot),
      writeRawArtifact(runId, stepId, "stderr.log", "stderr", stderr.content, options.runsRoot),
    ]);

    return {
      ok: exitCode === 0,
      exitCode,
      durationMs,
      stdoutArtifact,
      stderrArtifact,
      truncated: stdout.truncated || stderr.truncated,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const [stdoutArtifact, stderrArtifact] = await Promise.all([
      writeRawArtifact(runId, stepId, "stdout.log", "stdout", "", options.runsRoot),
      writeRawArtifact(runId, stepId, "stderr.log", "stderr", message, options.runsRoot),
    ]);
    return {
      ok: false,
      exitCode: timeoutController.signal.aborted ? TIMEOUT_EXIT_CODE : -1,
      durationMs,
      stdoutArtifact,
      stderrArtifact,
      truncated: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function capBytes(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes <= maxBytes) {
    return { content, truncated: false };
  }
  return {
    content: Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}

/** Minimal `AbortSignal.any` polyfill-free combinator (Node 24 has `AbortSignal.any` natively). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals);
}

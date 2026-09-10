import { readFile } from "node:fs/promises";
import type { AgentResult } from "@wf/agent-contracts";
import { execa } from "execa";
import { restrictedEnv } from "./env.js";
import { parseOpencodeStream } from "./ndjson.js";
import { writeRawArtifact } from "./artifact-writer.js";
import type { RunAgentInput } from "./types.js";

export interface RunAgentOptions {
  /** Overridable for tests; defaults to the real `opencode` binary. */
  bin?: string;
  cancelSignal?: AbortSignal;
  cwd?: string;
  runsRoot?: string;
}

/**
 * Real `@wf/agent-runtime` implementation of workflow-core's `RunAgent` signature. Spawns
 * `opencode run --format json`, streams NDJSON line-by-line, and never throws a raw unhandled
 * exception — every failure path resolves to an `ok:false` AgentResult.
 */
export async function runAgent(
  input: RunAgentInput,
  options: RunAgentOptions = {},
): Promise<AgentResult> {
  const bin = options.bin ?? "opencode";

  let promptContent: string;
  try {
    promptContent = await readFile(input.promptFile, "utf8");
  } catch (error) {
    return failure(input, "prompt-read-failed", messageOf(error));
  }

  const stdinPayload = JSON.stringify({
    prompt: promptContent,
    input: input.input,
  });

  const args = ["run", "--format", "json", "--model", input.model];

  try {
    const execaOptions = {
      input: stdinPayload,
      env: restrictedEnv(),
      killDescendants: true,
      reject: false as const,
      all: false as const,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.cancelSignal !== undefined ? { cancelSignal: options.cancelSignal } : {}),
    };
    const subprocess = execa(bin, args, execaOptions);

    if (!subprocess.stdout) {
      throw new Error("opencode subprocess produced no stdout stream");
    }

    const [parsed, result] = await Promise.all([
      parseOpencodeStream(subprocess.stdout),
      subprocess,
    ]);

    const exitCode = result.exitCode ?? -1;
    const ok = exitCode === 0 && !parsed.error && parsed.sawStop;

    if (!ok) {
      const artifact = await writeRawArtifact(
        input.input.run.id,
        input.input.stepId,
        "agent-stdout-raw.log",
        "log",
        parsed.rawCapture,
        options.runsRoot,
      );
      return {
        ok: false,
        role: input.role,
        stepId: input.input.stepId,
        summary: parsed.summary,
        artifacts: [artifact],
        error: {
          name: parsed.error?.name ?? "agent-run-failed",
          message: parsed.error?.data?.message ?? `opencode exited with code ${exitCode}`,
        },
      };
    }

    return {
      ok: true,
      role: input.role,
      stepId: input.input.stepId,
      summary: parsed.summary,
      artifacts: [],
    };
  } catch (error) {
    return failure(input, "agent-spawn-failed", messageOf(error));
  }
}

function failure(input: RunAgentInput, name: string, message: string): AgentResult {
  return {
    ok: false,
    role: input.role,
    stepId: input.input.stepId,
    summary: "",
    artifacts: [],
    error: { name, message },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

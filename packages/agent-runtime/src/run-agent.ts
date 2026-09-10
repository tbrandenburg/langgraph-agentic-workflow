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

  // `opencode run [message..]` reads its prompt from a POSITIONAL CLI argument, not stdin —
  // confirmed by direct testing: piping JSON to stdin (the previous approach) produces zero
  // output and no provider call at all; `opencode` silently ignores stdin here. The message must
  // be a single, readable (markdown) string, not a raw JSON dump — structured context (task,
  // upstream results) is embedded as a fenced JSON block for the model to read.
  const message = buildMessage(promptContent, input);
  const args = ["run", "--format", "json", "--model", input.model, message];

  try {
    const execaOptions = {
      // Explicitly close stdin: the message goes via argv (see above), and leaving stdin
      // inherited/open can cause `opencode` (or anything it shells out to) to block waiting for
      // input that will never arrive.
      stdin: "ignore" as const,
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

/** Builds a single readable (markdown) message: the prompt, followed by task + upstream
 * context as a fenced JSON block. This is what actually gets sent to `opencode run` — never a
 * raw JSON dump as the whole message. */
function buildMessage(promptContent: string, input: RunAgentInput): string {
  const context = {
    task: input.input.task,
    upstream: input.input.upstream,
    stepId: input.input.stepId,
  };
  return [
    promptContent.trim(),
    "",
    "## Context",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
  ].join("\n");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * `opencode run --format json` event shapes we care about (per docs/IMPLEMENTATION_PLAN.md M3 /
 * the NDJSON risk entry). Other event `type`s (e.g. `tool_use`, `step_start`) are tolerated but
 * not otherwise interpreted here.
 */
export interface TextEvent {
  type: "text";
  part: { text: string };
}

export interface StepFinishEvent {
  type: "step_finish";
  part: { reason: "stop" | "tool-calls" };
}

export interface ErrorEvent {
  type: "error";
  error: { name: string; data?: { message?: string; ref?: string } };
}

export interface OtherEvent {
  type: string;
  [key: string]: unknown;
}

export type OpencodeEvent = TextEvent | StepFinishEvent | ErrorEvent | OtherEvent;

export interface ParsedStream {
  /** Contiguous run of `text` events immediately preceding the terminal stop `step_finish`. */
  summary: string;
  /** First `error`-typed event seen, if any. */
  error: ErrorEvent["error"] | undefined;
  /** True if a `step_finish` with `reason: "stop"` was observed. */
  sawStop: boolean;
  /** Raw lines as received, byte-capped, for the malformed-output artifact escape hatch. */
  rawCapture: string;
}

/** Defensive byte cap on the raw capture kept for the malformed-output artifact path. */
const MAX_RAW_CAPTURE_BYTES = 2 * 1024 * 1024;

/**
 * Parses `opencode --format json` NDJSON output line-by-line via `readline`. Never
 * `JSON.parse`s the whole stream at once. Lines that fail to parse (e.g. truncated mid-write on
 * timeout) are skipped rather than throwing. Single consumer of `stdout` (raw lines are captured
 * here, byte-capped, rather than attaching a second competing listener to the same stream).
 */
export async function parseOpencodeStream(stdout: Readable): Promise<ParsedStream> {
  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  let pendingText: string[] = [];
  let summary = "";
  let error: ErrorEvent["error"] | undefined;
  let sawStop = false;
  const rawLines: string[] = [];
  let rawBytes = 0;

  for await (const line of rl) {
    if (rawBytes < MAX_RAW_CAPTURE_BYTES) {
      rawLines.push(line);
      rawBytes += Buffer.byteLength(line, "utf8") + 1;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const event = parseLine(trimmed);
    if (!event) {
      continue;
    }

    if (event.type === "text") {
      pendingText.push((event as TextEvent).part.text);
      continue;
    }

    if (event.type === "step_finish") {
      const finish = event as StepFinishEvent;
      if (finish.part.reason === "stop") {
        summary = pendingText.join("");
        sawStop = true;
      }
      pendingText = [];
      continue;
    }

    if (event.type === "error") {
      error ??= (event as ErrorEvent).error;
      pendingText = [];
      continue;
    }

    // Unknown/uninteresting event type (e.g. tool_use, step_start): breaks the contiguous
    // text run per the M3 spec ("contiguous run ... immediately preceding" the stop event).
    pendingText = [];
  }

  return { summary, error, sawStop, rawCapture: rawLines.join("\n") };
}

function parseLine(line: string): OpencodeEvent | null {
  try {
    return JSON.parse(line) as OpencodeEvent;
  } catch {
    return null;
  }
}

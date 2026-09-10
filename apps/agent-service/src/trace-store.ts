import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NodeName } from "@wf/workflow-core";

/**
 * Modified-M6 observability event: one structured JSON line per node start/end, replacing
 * LangSmith spans with a credential-free local trace. See handoff notes for the descoping
 * rationale (no LangSmith/Studio wiring).
 */
export interface TraceEvent {
  runId: string;
  projectId: string;
  workflowId: string;
  mode: "dry-run" | "live";
  nodeName: NodeName;
  stepId: string | null;
  phase: "start" | "end";
  timestampMs: number;
  durationMs?: number;
  ok?: boolean;
}

/**
 * Appends trace events as JSONL to `.runs/<runId>/trace.jsonl`, mirroring the `.runs/<runId>/...`
 * artifact convention already used by `workflow-core`'s `ArtifactStore` (M2/M3) rather than
 * inventing a new location.
 */
export class TraceWriter {
  constructor(private readonly runsRoot = ".runs") {}

  private pathFor(runId: string): string {
    return join(this.runsRoot, runId, "trace.jsonl");
  }

  async append(event: TraceEvent): Promise<void> {
    const path = this.pathFor(event.runId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

/** Reads and parses `.runs/<runId>/trace.jsonl`. Returns `null` if the trace file does not exist. */
export async function readTrace(runId: string, runsRoot = ".runs"): Promise<TraceEvent[] | null> {
  const path = join(runsRoot, runId, "trace.jsonl");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceEvent);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

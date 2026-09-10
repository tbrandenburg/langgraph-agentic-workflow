import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTrace, TraceWriter, type TraceEvent } from "./trace-store.js";

let runsRoot: string;

beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), "trace-store-test-"));
});

afterEach(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    runId: "run-1",
    projectId: "example-service",
    workflowId: "wf-1",
    mode: "dry-run",
    nodeName: "agent",
    stepId: "plan",
    phase: "start",
    timestampMs: Date.now(),
    ...overrides,
  };
}

describe("TraceWriter / readTrace", () => {
  it("appends events as JSONL and readTrace parses them back in order", async () => {
    const writer = new TraceWriter(runsRoot);
    await writer.append(event({ phase: "start" }));
    await writer.append(event({ phase: "end", durationMs: 12, ok: true }));

    const events = await readTrace("run-1", runsRoot);
    expect(events).toHaveLength(2);
    expect(events?.[0]?.phase).toBe("start");
    expect(events?.[1]).toMatchObject({ phase: "end", durationMs: 12, ok: true });
  });

  it("returns null when the trace file does not exist", async () => {
    const events = await readTrace("does-not-exist", runsRoot);
    expect(events).toBeNull();
  });

  it("creates the .runs/<runId>/ directory convention on first write", async () => {
    const writer = new TraceWriter(runsRoot);
    await writer.append(event());
    const events = await readTrace("run-1", runsRoot);
    expect(events).not.toBeNull();
  });
});

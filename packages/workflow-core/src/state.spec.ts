import { describe, expect, it } from "vitest";
import type { CommandResult } from "@wf/agent-contracts";
import { mergeResults } from "./state.js";

function makeCommandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    ok: true,
    exitCode: 0,
    durationMs: 1,
    stdoutArtifact: {
      id: "11111111-1111-1111-1111-111111111111",
      stepId: "s",
      kind: "stdout",
      path: "/tmp/x",
      bytes: 0,
      sha256: "0".repeat(64),
    },
    stderrArtifact: {
      id: "22222222-2222-2222-2222-222222222222",
      stepId: "s",
      kind: "stderr",
      path: "/tmp/y",
      bytes: 0,
      sha256: "0".repeat(64),
    },
    truncated: false,
    ...overrides,
  };
}

describe("RunState results reducer", () => {
  it("never drops prior entries when merging new results", () => {
    const first = { step1: makeCommandResult() };
    const second = { step2: makeCommandResult({ ok: false }) };

    const merged = mergeResults(first, second);

    expect(merged).toHaveProperty("step1");
    expect(merged).toHaveProperty("step2");
    expect(merged.step1?.ok).toBe(true);
    expect(merged.step2?.ok).toBe(false);
  });

  it("overwrites only the specific stepId key on repeated updates", () => {
    const first = { step1: makeCommandResult({ ok: true }) };
    const updated = mergeResults(first, { step1: makeCommandResult({ ok: false }) });

    expect(Object.keys(updated)).toEqual(["step1"]);
    expect(updated.step1?.ok).toBe(false);
  });
});

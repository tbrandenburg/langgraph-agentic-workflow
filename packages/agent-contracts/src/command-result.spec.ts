import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CommandResultSchema } from "./command-result.js";

const stdoutArtifact = {
  id: "5f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
  stepId: "step-2",
  kind: "stdout",
  path: ".runs/run-1/step-2/stdout.txt",
  bytes: 5,
  sha256: "c".repeat(64),
};

const stderrArtifact = {
  ...stdoutArtifact,
  id: "6f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5c",
  kind: "stderr",
  path: ".runs/run-1/step-2/stderr.txt",
};

const validCommandResult = {
  ok: true,
  exitCode: 0,
  durationMs: 120,
  stdoutArtifact,
  stderrArtifact,
  truncated: false,
};

describe("CommandResultSchema", () => {
  it("parses a valid command result", () => {
    expect(CommandResultSchema.parse(validCommandResult)).toEqual(validCommandResult);
  });

  it("rejects an invalid command result", () => {
    const invalid = { ...validCommandResult, exitCode: "0", durationMs: -1 };
    const result = CommandResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
    }
  });
});

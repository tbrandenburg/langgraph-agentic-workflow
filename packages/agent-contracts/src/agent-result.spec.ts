import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AgentResultSchema } from "./agent-result.js";

const validArtifact = {
  id: "5f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
  stepId: "step-1",
  kind: "log",
  path: ".runs/run-1/step-1/log.txt",
  bytes: 10,
  sha256: "b".repeat(64),
};

const validAgentResult = {
  ok: true,
  role: "planner",
  stepId: "step-1",
  summary: "Produced a plan.",
  artifacts: [validArtifact],
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
};

describe("AgentResultSchema", () => {
  it("parses a valid agent result", () => {
    expect(AgentResultSchema.parse(validAgentResult)).toEqual(validAgentResult);
  });

  it("parses a valid failed agent result with error", () => {
    const failed = {
      ok: false,
      role: "planner",
      stepId: "step-1",
      summary: "",
      artifacts: [],
      error: { name: "TimeoutError", message: "exceeded 30s" },
    };
    expect(AgentResultSchema.parse(failed)).toEqual(failed);
  });

  it("rejects an invalid agent result", () => {
    const invalid = { ...validAgentResult, ok: "yes", artifacts: "not-an-array" };
    const result = AgentResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
    }
  });
});

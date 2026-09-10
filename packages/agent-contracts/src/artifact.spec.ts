import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ArtifactRefSchema } from "./artifact.js";

const validArtifact = {
  id: "5f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
  stepId: "step-1",
  kind: "stdout",
  path: ".runs/run-1/step-1/stdout.txt",
  bytes: 42,
  sha256: "a".repeat(64),
};

describe("ArtifactRefSchema", () => {
  it("parses a valid artifact ref", () => {
    expect(ArtifactRefSchema.parse(validArtifact)).toEqual(validArtifact);
  });

  it("rejects an invalid artifact ref", () => {
    const invalid = { ...validArtifact, kind: "not-a-kind", sha256: "too-short" };
    const result = ArtifactRefSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
    }
  });
});

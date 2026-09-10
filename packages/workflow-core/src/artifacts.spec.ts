import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "./artifacts.js";

describe("ArtifactStore", () => {
  let runsRoot: string;

  beforeEach(async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "artifacts-test-"));
  });

  afterEach(async () => {
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("computes sha256 and byte count correctly", async () => {
    const store = new ArtifactStore("run-1", { runsRoot });
    const content = "hello world";

    const artifact = await store.write("step-a", "out.txt", "stdout", content);

    expect(artifact.bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(artifact.sha256).toBe(createHash("sha256").update(content, "utf8").digest("hex"));
    expect(artifact.kind).toBe("stdout");
    expect(artifact.stepId).toBe("step-a");
  });

  it("enforces write-once semantics", async () => {
    const store = new ArtifactStore("run-1", { runsRoot });
    await store.write("step-a", "out.txt", "stdout", "first");

    await expect(store.write("step-a", "out.txt", "stdout", "second")).rejects.toThrow(
      /already exists/,
    );
  });

  it("applies the redaction hook before writing", async () => {
    const store = new ArtifactStore("run-1", {
      runsRoot,
      redactor: (content) => content.replace("secret", "[REDACTED]"),
    });

    const artifact = await store.write("step-a", "out.txt", "log", "token=secret");

    expect(artifact.sha256).toBe(
      createHash("sha256").update("token=[REDACTED]", "utf8").digest("hex"),
    );
  });
});

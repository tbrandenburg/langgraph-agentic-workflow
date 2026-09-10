import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScript } from "./run-script.js";

describe("runScript", () => {
  let workspace: string;
  let runsRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "run-script-ws-"));
    runsRoot = await mkdtemp(join(tmpdir(), "run-script-runs-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(runsRoot, { recursive: true, force: true });
  });

  async function writeScript(name: string, content: string): Promise<string> {
    const path = join(workspace, name);
    await writeFile(path, content, "utf8");
    await chmod(path, 0o755);
    return path;
  }

  it("returns ok:true with exitCode 0 on success", async () => {
    const scriptPath = await writeScript("ok.sh", "echo hello\n");

    const result = await runScript(
      {
        path: scriptPath,
        workspace,
        input: {},
        idempotencyKey: "run-1:step-a",
        timeoutSeconds: 5,
      },
      { runsRoot },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("returns ok:false with the script's non-zero exit code", async () => {
    const scriptPath = await writeScript("fail.sh", "exit 3\n");

    const result = await runScript(
      {
        path: scriptPath,
        workspace,
        input: {},
        idempotencyKey: "run-1:step-b",
        timeoutSeconds: 5,
      },
      { runsRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("returns ok:false, exitCode 124 when the script exceeds the timeout", async () => {
    const scriptPath = await writeScript("sleepy.sh", "sleep 999\n");

    const result = await runScript(
      {
        path: scriptPath,
        workspace,
        input: {},
        idempotencyKey: "run-1:step-c",
        timeoutSeconds: 1,
      },
      { runsRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(124);
  }, 10_000);

  it("exports the idempotency key to the script as IDEMPOTENCY_KEY", async () => {
    const scriptPath = await writeScript("echo-key.sh", 'echo "$IDEMPOTENCY_KEY"\n');

    const result = await runScript(
      {
        path: scriptPath,
        workspace,
        input: {},
        idempotencyKey: "run-42:step-x",
        timeoutSeconds: 5,
      },
      { runsRoot },
    );

    expect(result.ok).toBe(true);
  });
});

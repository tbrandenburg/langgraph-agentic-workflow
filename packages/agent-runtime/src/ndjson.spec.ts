import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseOpencodeStream } from "./ndjson.js";

function streamOf(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`).join(""));
}

describe("parseOpencodeStream", () => {
  it("captures the contiguous text run immediately preceding a stop step_finish", async () => {
    const lines = [
      JSON.stringify({ type: "step_start" }),
      JSON.stringify({ type: "text", part: { text: "Hello, " } }),
      JSON.stringify({ type: "text", part: { text: "world." } }),
      JSON.stringify({ type: "step_finish", part: { reason: "stop" } }),
    ];

    const result = await parseOpencodeStream(streamOf(lines));

    expect(result.summary).toBe("Hello, world.");
    expect(result.sawStop).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("does not treat a tool-calls step_finish as terminal", async () => {
    const lines = [
      JSON.stringify({ type: "text", part: { text: "thinking" } }),
      JSON.stringify({ type: "step_finish", part: { reason: "tool-calls" } }),
      JSON.stringify({ type: "tool_use" }),
      JSON.stringify({ type: "text", part: { text: "final answer" } }),
      JSON.stringify({ type: "step_finish", part: { reason: "stop" } }),
    ];

    const result = await parseOpencodeStream(streamOf(lines));

    expect(result.summary).toBe("final answer");
    expect(result.sawStop).toBe(true);
  });

  it("records an error event and does not crash on it", async () => {
    const lines = [
      JSON.stringify({ type: "text", part: { text: "partial" } }),
      JSON.stringify({
        type: "error",
        error: { name: "ProviderError", data: { message: "boom" } },
      }),
    ];

    const result = await parseOpencodeStream(streamOf(lines));

    expect(result.error).toEqual({ name: "ProviderError", data: { message: "boom" } });
    expect(result.sawStop).toBe(false);
  });

  it("skips trailing non-JSON-parseable lines instead of throwing", async () => {
    const lines = [
      JSON.stringify({ type: "text", part: { text: "ok" } }),
      JSON.stringify({ type: "step_finish", part: { reason: "stop" } }),
      '{"truncated": tr', // malformed trailing line (e.g. cut off mid-write on timeout)
    ];

    const result = await parseOpencodeStream(streamOf(lines));

    expect(result.summary).toBe("ok");
    expect(result.sawStop).toBe(true);
  });

  it("caps the raw capture buffer to bound memory", async () => {
    const bigLine = JSON.stringify({ type: "text", part: { text: "x".repeat(1000) } });
    const lines = Array.from({ length: 5 }, () => bigLine);

    const result = await parseOpencodeStream(streamOf(lines));

    expect(result.rawCapture.length).toBeGreaterThan(0);
  });
});

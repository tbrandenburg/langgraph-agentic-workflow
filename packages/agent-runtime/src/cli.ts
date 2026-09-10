#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { AgentResultSchema } from "@wf/agent-contracts";
import { dryRunAgent } from "./dry-run.js";
import { runAgent } from "./run-agent.js";
import type { RunAgentInput } from "./types.js";

interface CliFlags {
  role: string;
  input: string;
  output: string;
  prompt: string;
  model: string;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const role = get("role");
  const input = get("input");
  const output = get("output");
  const prompt = get("prompt");
  const model = get("model");
  if (!role || !input || !output || !prompt || !model) {
    throw new Error(
      "Usage: agent-runtime run --role <r> --input in.json --output out.json --prompt <file> --model <m> [--dry-run]",
    );
  }
  return { role, input, output, prompt, model, dryRun: argv.includes("--dry-run") };
}

interface AgentInputFile {
  run: RunAgentInput["input"]["run"];
  task: RunAgentInput["input"]["task"];
  upstream: RunAgentInput["input"]["upstream"];
  stepId: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] !== "run") {
    throw new Error("Usage: agent-runtime run --role <r> --input in.json --output out.json ...");
  }
  const flags = parseFlags(argv.slice(1));

  const rawInput = await readFile(flags.input, "utf8");
  const parsedInput = JSON.parse(rawInput) as AgentInputFile;

  const runAgentInput: RunAgentInput = {
    promptFile: flags.prompt,
    role: flags.role,
    model: flags.model,
    input: {
      run: parsedInput.run,
      task: parsedInput.task,
      upstream: parsedInput.upstream,
      stepId: parsedInput.stepId,
    },
  };

  const isDryRun = flags.dryRun || process.env.AGENT_DRY_RUN === "1";
  const result = isDryRun ? await dryRunAgent(runAgentInput) : await runAgent(runAgentInput);

  const validated = AgentResultSchema.parse(result);
  await writeFile(flags.output, JSON.stringify(validated, null, 2), "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

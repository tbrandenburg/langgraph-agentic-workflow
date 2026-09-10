import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunStateType, RunStateUpdate } from "../state.js";

/**
 * Core `initialize` node: assigns a run id (if not already provided), creates an ephemeral
 * workspace directory, and marks the run as running. Uses `crypto.randomUUID()` (UUIDv4) rather
 * than adding the `uuid` package as a dependency — Node's built-in is sufficient for a run id.
 */
export async function initializeRun(state: RunStateType): Promise<RunStateUpdate> {
  const runId = state.run.id || crypto.randomUUID();
  const workspace = state.run.workspace || (await mkdtemp(join(tmpdir(), `wf-${runId}-`)));

  return {
    run: {
      ...state.run,
      id: runId,
      workspace,
      createdAt: state.run.createdAt || new Date().toISOString(),
    },
    stepIndex: 0,
    currentStep: null,
    status: "running",
  };
}

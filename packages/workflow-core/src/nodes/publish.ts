import { ArtifactRefSchema, type ArtifactRef } from "@wf/agent-contracts";
import type { RunStateType, RunStateUpdate } from "../state.js";
import { ArtifactStore } from "../artifacts.js";

/**
 * Core `publish` node: determines final run status (failed if any completed step reported
 * `ok:false`, succeeded otherwise) and writes an artifact manifest listing every artifact
 * collected across `results`.
 */
export async function publishSummary(state: RunStateType): Promise<RunStateUpdate> {
  const anyFailure = Object.values(state.results).some((result) => !result.ok);
  const status = anyFailure ? "failed" : "succeeded";

  const artifacts: ArtifactRef[] = [];
  for (const result of Object.values(state.results)) {
    if ("artifacts" in result) {
      artifacts.push(...result.artifacts);
    }
    if ("stdoutArtifact" in result) {
      artifacts.push(result.stdoutArtifact, result.stderrArtifact);
    }
  }

  const manifest = {
    runId: state.run.id,
    workflowId: state.run.workflowId,
    status,
    mode: state.run.mode,
    artifacts: artifacts.map((artifact) => ArtifactRefSchema.parse(artifact)),
  };

  const store = new ArtifactStore(state.run.id);
  await store.write("publish", "manifest.json", "manifest", JSON.stringify(manifest, null, 2));

  return { status };
}

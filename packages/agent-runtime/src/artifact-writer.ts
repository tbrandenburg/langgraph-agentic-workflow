import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArtifactKind, ArtifactRef } from "@wf/agent-contracts";
import { ArtifactRefSchema } from "@wf/agent-contracts";

/**
 * Minimal artifact writer following the same `.runs/<runId>/<stepId>/<name>` convention as
 * `@wf/workflow-core`'s `ArtifactStore` (packages/workflow-core/src/artifacts.ts). Intentionally
 * duplicated (not imported) to keep `@wf/agent-runtime` fully decoupled from `workflow-core` —
 * this package is called BY workflow-core's nodes, so a dependency in the other direction would
 * be circular in spirit even if not literally cyclic at the package-graph level. Kept tiny
 * on purpose; only used for the "raw stdout on malformed output" escape hatch.
 */
export async function writeRawArtifact(
  runId: string,
  stepId: string,
  name: string,
  kind: ArtifactKind,
  content: string,
  runsRoot = ".runs",
): Promise<ArtifactRef> {
  const dir = join(runsRoot, runId, stepId);
  const path = join(dir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");

  const bytes = Buffer.byteLength(content, "utf8");
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");

  const artifact: ArtifactRef = {
    id: randomUUID(),
    stepId,
    kind,
    path,
    bytes,
    sha256,
  };

  return ArtifactRefSchema.parse(artifact);
}

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { basicSecretRedactor } from "@wf/workflow-core";

/**
 * M5 log redaction. `workflow-core`'s `ArtifactStore` (used internally by the `publish` node) and
 * `agent-runtime`'s raw-dump writer both write artifacts directly to `.runs/<runId>/**` with no
 * redaction hook exposed to this process (the hook exists on `ArtifactStore`'s constructor, but
 * it is only reachable by editing `nodes/publish.ts`, which is out of this milestone's allowed
 * file set). Pragmatic PoC-scoped alternative: redact every artifact file for a run, in place,
 * right after the run finishes ("applied... before publication" per INITIAL.md's reliability
 * section) using workflow-core's already-exported `basicSecretRedactor`.
 */
export async function redactRunArtifacts(runId: string, runsRoot = ".runs"): Promise<void> {
  const runDir = join(runsRoot, runId);
  const files = await listFilesRecursive(runDir);
  await Promise.all(
    files.map(async (path) => {
      const content = await readFile(path, "utf8");
      const redacted = basicSecretRedactor(content);
      if (redacted !== content) {
        await writeFile(path, redacted, "utf8");
      }
    }),
  );
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

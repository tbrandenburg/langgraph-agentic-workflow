import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { ArtifactRefSchema, type ArtifactKind, type ArtifactRef } from "@wf/agent-contracts";

/** Redaction hook applied to content before it is written to disk. */
export type Redactor = (content: string) => string;

/** Minimal default redactor: no-op. Projects/operators may plug in a stricter one. */
export const noopRedactor: Redactor = (content) => content;

/** Basic pattern-based redaction for common secret shapes. Kept intentionally minimal. */
export const basicSecretRedactor: Redactor = (content) =>
  content.replace(
    /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
    "$&".replace(/\S+$/, "[REDACTED]"),
  );

export interface ArtifactStoreOptions {
  runsRoot?: string;
  redactor?: Redactor;
}

export class ArtifactStore {
  private readonly runsRoot: string;
  private readonly redactor: Redactor;

  constructor(
    private readonly runId: string,
    options: ArtifactStoreOptions = {},
  ) {
    this.runsRoot = options.runsRoot ?? ".runs";
    this.redactor = options.redactor ?? noopRedactor;
  }

  /** Writes content once under `.runs/<runId>/<stepId>/<name>`. Throws if the path already exists. */
  async write(
    stepId: string,
    name: string,
    kind: ArtifactKind,
    content: string,
  ): Promise<ArtifactRef> {
    const dir = join(this.runsRoot, this.runId, stepId);
    const path = join(dir, name);

    if (await pathExists(path)) {
      throw new Error(`Artifact write-once violation: ${path} already exists`);
    }

    const redacted = this.redactor(content);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, redacted, "utf8");

    const bytes = Buffer.byteLength(redacted, "utf8");
    const sha256 = createHash("sha256").update(redacted, "utf8").digest("hex");

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
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

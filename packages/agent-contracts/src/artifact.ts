import { z } from "zod";

export const ArtifactKindSchema = z.enum(["stdout", "stderr", "patch", "log", "manifest", "other"]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactRefSchema = z.object({
  id: z.string().uuid(),
  stepId: z.string(),
  kind: ArtifactKindSchema,
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

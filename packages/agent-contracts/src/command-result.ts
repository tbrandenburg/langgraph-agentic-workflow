import { z } from "zod";
import { ArtifactRefSchema } from "./artifact.js";

export const CommandResultSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number().int(),
  durationMs: z.number().nonnegative(),
  stdoutArtifact: ArtifactRefSchema,
  stderrArtifact: ArtifactRefSchema,
  truncated: z.boolean(),
});

export type CommandResult = z.infer<typeof CommandResultSchema>;

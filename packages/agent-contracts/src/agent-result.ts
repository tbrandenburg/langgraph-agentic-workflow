import { z } from "zod";
import { ArtifactRefSchema } from "./artifact.js";

const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

const AgentErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
});

export const AgentResultSchema = z.object({
  ok: z.boolean(),
  role: z.string(),
  stepId: z.string(),
  summary: z.string(),
  artifacts: z.array(ArtifactRefSchema),
  usage: UsageSchema.optional(),
  error: AgentErrorSchema.optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

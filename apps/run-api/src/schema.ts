import { z } from "zod";

/** Zod schema for POST /runs. No prompt/command passthrough: only project+workflow selectors. */
export const StartRunBodySchema = z
  .object({
    project: z.string().min(1),
    workflow: z.string().min(1),
    task: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();

export type StartRunBody = z.infer<typeof StartRunBodySchema>;

export const RunIdParamsSchema = z.object({ runId: z.string().uuid() });

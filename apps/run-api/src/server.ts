import Fastify, { type FastifyInstance } from "fastify";
import type { AgentService } from "@app/agent-service";
import { CapacityExceededError, UnknownProjectOrWorkflowError } from "@app/agent-service";
import { RunIdParamsSchema, StartRunBodySchema } from "./schema.js";

/**
 * Builds the Fastify app. Uses Fastify's built-in pino logger for structured JSON logs (per M5's
 * "prefer Fastify's built-in logger rather than adding a new dependency"). Accepts an existing
 * `FastifyInstance` (so `apps/run-api/src/index.ts` can share one pino logger between the HTTP
 * access logs and agent-service's structured run logs) or creates a fresh one for tests.
 */
export function buildServer(
  agentService: AgentService,
  app: FastifyInstance = Fastify({ logger: true }),
): FastifyInstance {
  app.post("/runs", async (request, reply) => {
    const parsed = StartRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      const { runId } = await agentService.startRun(parsed.data);
      return reply.code(202).send({ runId });
    } catch (error) {
      if (error instanceof CapacityExceededError) {
        return reply.code(429).send({ error: "capacity_exceeded", message: error.message });
      }
      if (error instanceof UnknownProjectOrWorkflowError) {
        return reply
          .code(400)
          .send({ error: "unknown_project_or_workflow", message: error.message });
      }
      throw error;
    }
  });

  app.get("/runs/:runId", async (request, reply) => {
    const parsed = RunIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_run_id" });
    }
    const run = await agentService.getRun(parsed.data.runId);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    return reply.send(run);
  });

  app.post("/runs/:runId/cancel", async (request, reply) => {
    const parsed = RunIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_run_id" });
    }
    const cancelled = await agentService.cancelRun(parsed.data.runId);
    if (!cancelled) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    return reply.send({ cancelled: true });
  });

  // Placeholder for M6d: a real Prometheus /metrics endpoint. Kept as a documented stub here so
  // the compose file's commented-out scrape target has something to point at without building
  // full metrics collection in M5.
  app.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send("# metrics not yet implemented (see M6d)\n");
  });

  return app;
}

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

  app.get("/runs/:runId/trace", async (request, reply) => {
    const parsed = RunIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_run_id" });
    }
    const trace = await agentService.getTrace(parsed.data.runId);
    if (!trace) {
      return reply.code(404).send({ error: "trace_not_found" });
    }
    return reply.send(trace);
  });

  // Modified-M6 (LangSmith/Prometheus descoped): real in-memory counters returned as JSON rather
  // than Prometheus text exposition format — see `apps/agent-service/src/metrics.ts` for the
  // documented rationale.
  app.get("/metrics", async (_request, reply) => {
    return reply.send(agentService.getMetrics());
  });

  return app;
}

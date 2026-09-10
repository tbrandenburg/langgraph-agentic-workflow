import { startAgentService } from "@app/agent-service";
import Fastify from "fastify";
import { buildServer } from "./server.js";

/**
 * `apps/run-api` entrypoint. Single-process PoC design decision (see README note in this file's
 * directory / handoff): `apps/agent-service` is imported as an in-process library rather than run
 * as a second network-facing service. The M5 plan bullet list names two logical concerns (API
 * surface vs. graph execution) but does not mandate two independently-deployable OS processes;
 * wiring an HTTP client/server pair between them would add IPC complexity with no PoC benefit
 * (KISS). `startAgentService()` still lives in its own `apps/agent-service` package/module
 * boundary, so splitting it into a standalone process later only requires adding a thin HTTP
 * shim, not a rewrite.
 */
async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);

  // Build the Fastify instance first so agent-service's structured logs share the same pino
  // logger (and therefore the same JSON format / destination) as the HTTP access logs.
  const app = Fastify({ logger: true });
  const agentService = await startAgentService({ logger: app.log });
  buildServer(agentService, app);

  const shutdown = async (): Promise<void> => {
    agentService.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/** Builds the LangGraph thread id for a given run id. 1 thread per run, never shared. */
export function threadIdForRun(runId: string): string {
  return `agent-run/${runId}`;
}

/**
 * Creates a checkpointer. Uses Postgres when `DATABASE_URL` is set, otherwise falls back to
 * an in-memory checkpointer (fine for local dev / PoC, does not survive process restarts).
 */
export async function createCheckpointer(): Promise<BaseCheckpointSaver> {
  const connString = process.env.DATABASE_URL;
  if (!connString) {
    return new MemorySaver();
  }

  const saver = PostgresSaver.fromConnString(connString);
  await saver.setup();
  return saver;
}

/**
 * Retention sweeper: deletes checkpoint history for finalized runs older than `cutoff`.
 * Minimal PoC version — no scheduler, callers invoke this periodically (e.g. from a cron job
 * or ops script) with the list of run ids known to be finalized before `cutoff`.
 */
export async function sweepFinalizedRuns(
  checkpointer: BaseCheckpointSaver,
  finalizedRunIds: { runId: string; finalizedAt: Date }[],
  cutoff: Date,
): Promise<string[]> {
  const deleted: string[] = [];
  for (const { runId, finalizedAt } of finalizedRunIds) {
    if (finalizedAt.getTime() <= cutoff.getTime()) {
      await checkpointer.deleteThread(threadIdForRun(runId));
      deleted.push(runId);
    }
  }
  return deleted;
}

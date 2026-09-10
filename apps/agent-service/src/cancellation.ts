/**
 * Per-run cancellation registry: maps `runId` -> `AbortController`. Node-level runners (wired in
 * runners.ts) look up the controller for their run and forward its `signal` as the real
 * `runAgent`/`runScript`'s `cancelSignal` option. This keeps `packages/workflow-core` and
 * `packages/agent-runtime` completely untouched: workflow-core's `RunAgent`/`RunScript` node
 * signatures already carry `input.run.id` (agent) / an `idempotencyKey` prefixed with the run id
 * (bash), which is all this registry needs to resolve the right controller.
 */
export class CancellationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(runId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  signalFor(runId: string): AbortSignal | undefined {
    return this.controllers.get(runId)?.signal;
  }

  /** Returns true if a run with this id was found and abort() was signalled. */
  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  release(runId: string): void {
    this.controllers.delete(runId);
  }
}

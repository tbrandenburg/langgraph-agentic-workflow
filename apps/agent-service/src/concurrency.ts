import { CapacityExceededError } from "./types.js";

/** Minimal in-memory concurrency semaphore. No distributed queue — PoC-scoped per M5. */
export class ConcurrencyLimiter {
  private active = 0;

  constructor(private readonly max: number) {}

  /** Throws `CapacityExceededError` (mapped to HTTP 429 by run-api) when at capacity. */
  acquire(): void {
    if (this.active >= this.max) {
      throw new CapacityExceededError(
        `MAX_CONCURRENT_RUNS (${this.max}) reached; retry once a run finishes`,
      );
    }
    this.active += 1;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}

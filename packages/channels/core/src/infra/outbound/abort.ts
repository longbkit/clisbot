// upstream: src/infra/outbound/abort.ts@5d8067a4483
import { createAbortError } from "../abort-signal.js";

/**
 * Throws an AbortError if the given signal has been aborted.
 * Use at async checkpoints to support cancellation.
 */
export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError("Operation aborted");
  }
}

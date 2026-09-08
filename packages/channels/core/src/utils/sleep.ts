// upstream: src/utils/sleep.ts@5d8067a4483
import { resolveTimerTimeoutMs } from "../normalization-core/number-coercion.js";
import { sleepWithAbort } from "../retry/index.js";
import { createAbortError } from "../infra/abort-signal.js";

/** Promise-based sleep that clamps timer inputs through the shared timeout resolver. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const delayMs = resolveTimerTimeoutMs(ms, 0, 0);
  if (signal) {
    // Cancellation wins even for zero-delay waits so aborted runs cannot
    // advance into follow-on work such as computer-tool screenshot capture.
    if (signal.aborted) {
      return Promise.reject(
        createAbortError("aborted", { cause: signal.reason ?? new Error("aborted") }),
      );
    }
    return sleepWithAbort(delayMs, signal);
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// Fusion-owned boundary for `withTimeout` (D-ZU-008).
//
// Upstream reads it from `openclaw/plugin-sdk/security-runtime`, which
// re-exports it from the `@openclaw/fs-safe` workspace package. Fusion never
// depends on an OpenClaw workspace package, and `@getpaseo/channels-core`'s
// `security-runtime` boundary deliberately stops at the secret-compare and
// external-content members (D-CORE-244). The two ported call sites
// (`zalo-js.ts`: restoring a session, and the session health check) need one
// thing — reject with a named message when the promise outruns its budget —
// so the boundary keeps that call shape and nothing else. The rejected
// promise's own settlement is NOT cancelled, which is upstream's behaviour too:
// `zca-js` exposes no abort for a login.

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  options: { message?: string } = {},
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return await promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(options.message ?? `Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

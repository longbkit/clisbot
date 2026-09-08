// upstream: src/media/fetch.ts@5d8067a4483 (the error class only)
// D-CORE-325: upstream declares `MediaFetchError` inside `src/media/fetch.ts`, a
// 770-line guarded media downloader built on OpenClaw's pinned-dispatcher SSRF
// stack and retry policy. Fusion's Hub owns media authorization and each
// vertical owns its own fetch, so only the closed error class — which ported
// channel code throws and matches on by `code` — is carried, unchanged, in a
// file named for it.

/** Closed error classes callers can use for retry and diagnostic policy. */
export type MediaFetchErrorCode = "max_bytes" | "http_error" | "fetch_failed";

/** Structured fetch error used for retry decisions and caller-facing diagnostics. */
export class MediaFetchError extends Error {
  readonly code: MediaFetchErrorCode;
  readonly status?: number;

  constructor(
    code: MediaFetchErrorCode,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, options);
    this.code = code;
    this.status = options?.status;
    this.name = "MediaFetchError";
  }
}

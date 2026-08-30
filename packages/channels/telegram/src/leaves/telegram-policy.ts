// L1 transport-policy leaf — the Bot API fetch/retry/throttle boundary
// (blueprint §6.5 L1). Port of the pinned chunk's fetch boundary +
// openclaw/extensions/telegram/src/send-error-predicates.ts + retry-after
// boundary (see SYNC.md). No OpenClaw specifiers; error classification is
// duck-typed so this leaf loads without the grammy stack at type level.

import { Readable } from "node:stream";

/** Cap for a 429 `retry_after` delay (the pinned retry-after boundary,
 * decided at 60s — D-002). */
export const TELEGRAM_OUTBOUND_RETRY_AFTER_CAP_MS = 60_000;

/** The transport seam the plane may supply (injected fetch). */
export interface TelegramTransport {
  fetch?: typeof globalThis.fetch | undefined;
}

/** The throttler shape bot-api's `api.config.use` installs. */
export type TelegramApiThrottler = (
  prev: unknown,
  method: unknown,
  payload: unknown,
  signal: unknown,
) => Promise<unknown>;

const accountThrottlers = new Map<string, TelegramApiThrottler>();

/** One Bottleneck-backed throttler per account (module-level cache, same
 * lifetime as the pinned chunk — the pinned dep is kept, §7.2). The grammy
 * stack loads lazily at this call site: the L2 poll loop and the L3 inbound
 * path never touch it, so tests can exercise the vertical without the dep. */
export async function createTelegramAccountThrottler(token: string): Promise<TelegramApiThrottler> {
  let throttler = accountThrottlers.get(token);
  if (throttler === undefined) {
    const { apiThrottler } = await import("@grammyjs/transformer-throttler");
    throttler = apiThrottler() as unknown as TelegramApiThrottler;
    accountThrottlers.set(token, throttler);
  }
  return throttler;
}

/** Normalize a fetch init handed by grammy for undici's global fetch.
 *
 * grammy's `createFormDataPayload` builds the multipart body as a Node
 * `Readable` (`stream.Readable.from`) and its *default* Node fetch is
 * node-fetch, which streams Node `Readable`s fine. This vertical, however,
 * always hands grammy its own fetch (undici's `globalThis.fetch` here), and
 * undici cannot transmit a Node `Readable` as `body` — it wants a web
 * `ReadableStream` (and requires `duplex: "half"` for a streaming body).
 * Left alone, every file upload (the G7–G11 media path) throws while JSON
 * calls (string bodies) succeed.
 *
 * Non-`Readable` bodies (JSON strings, FormData, …) pass through unchanged. */
function normalizeFetchInit(init: RequestInit | undefined): RequestInit | undefined {
  if (init === undefined || !(init.body instanceof Readable)) return init;
  // `Readable.toWeb` returns the global web `ReadableStream` at runtime; the
  // `stream/web` and DOM lib types differ structurally, so cast at the boundary
  // (same treatment as shared/src/media.ts for undici response bodies).
  const body = Readable.toWeb(init.body) as unknown as ReadableStream;
  // `duplex` is required by undici for streaming bodies; the pinned lib's
  // `RequestInit` predates it, so it is carried through a type assertion.
  return { ...init, body, duplex: "half" } as RequestInit;
}

/** The injected fetch with a per-request timeout (the pinned
 * `resolveTelegramClientOptions` fetch half). The init is always normalized
 * for undici first (see `normalizeFetchInit`); when no timeout is configured
 * the transport's fetch (or global fetch) otherwise passes through untouched. */
export function createTelegramClientFetch(options: {
  timeoutSeconds?: number;
  transport?: TelegramTransport;
}): typeof globalThis.fetch {
  const base = options.transport?.fetch ?? globalThis.fetch;
  const timeoutSeconds = options.timeoutSeconds;
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0
  ) {
    return async (input, init) => base(input, normalizeFetchInit(init));
  }
  const timeoutMs = Math.round(timeoutSeconds * 1000);
  return async (input, init) => {
    const controller = new AbortController();
    const external = init?.signal ?? null;
    if (external !== null) {
      if (external.aborted) controller.abort(external.reason);
      else
        external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
    }
    const timer = setTimeout(
      () => controller.abort(new Error(`Telegram request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const normalized = normalizeFetchInit(init);
      return await base(input, { ...normalized, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

function firstOf<V>(
  record: Record<string, unknown>,
  keys: readonly string[],
  type: typeof Number | typeof String,
): V | undefined {
  for (const key of keys) {
    const value = record[key];
    if (type === Number ? typeof value === "number" : typeof value === "string") {
      return value as V;
    }
  }
  return undefined;
}

function errorFields(error: unknown): {
  statusCode: number | undefined;
  errorCode: number | undefined;
  description: string | undefined;
} {
  if (typeof error !== "object" || error === null) {
    return { statusCode: undefined, errorCode: undefined, description: undefined };
  }
  const record = error as Record<string, unknown>;
  return {
    statusCode: firstOf<number>(record, ["status", "statusCode"], Number),
    errorCode: firstOf<number>(record, ["error_code", "errorCode"], Number),
    description: firstOf<string>(record, ["description", "message"], String),
  };
}

/** 429 flood-control: `retry_after` applies. */
export function isTelegramRateLimitError(error: unknown): boolean {
  const { statusCode, errorCode } = errorFields(error);
  return statusCode === 429 || errorCode === 429;
}

/** 5xx: the Bot API is down or restarting — safe to retry. */
export function isTelegramServerError(error: unknown): boolean {
  const { statusCode, errorCode } = errorFields(error);
  return (
    (statusCode !== undefined && statusCode >= 500) || (errorCode !== undefined && errorCode >= 500)
  );
}

/** True when a failed send may be retried: 5xx, 429, or a local network
 * fault (the pinned `isSafeToRetrySendError`). */
export function isSafeToRetrySendError(error: unknown): boolean {
  if (isTelegramServerError(error) || isTelegramRateLimitError(error)) return true;
  const { description } = errorFields(error);
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown })["name"] ?? "")
      : "";
  const message = description ?? "";
  return (
    name === "TypeError" &&
    /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)
  );
}

/** The 400 "message is not modified" guard (no-op sends are not errors the
 * Hub should surface). */
export function isTelegramMessageNotModifiedError(error: unknown): boolean {
  const { description } = errorFields(error);
  return /message is not modified/i.test(description ?? "");
}

/** Validate + normalize an account's `apiRoot` (trailing slash stripped). */
export function resolveTelegramApiRoot(apiRoot: string): string {
  const trimmed = apiRoot.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error(`invalid Telegram apiRoot "${apiRoot}" (must be an http(s) URL)`);
  }
  return trimmed;
}

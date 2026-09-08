// upstream: src/plugin-sdk/provider-http.ts@5d8067a4483
// Shared provider-facing HTTP helpers. Keep generic transport utilities here so
// capability SDKs do not depend on each other.

/** Bounds a pending read so a stalled provider body cannot hold the caller. */
function raceWithTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number | undefined,
  sentinel: T,
): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return pending;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(sentinel);
    }, timeoutMs);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/**
 * Reads at most `limitBytes` from a response body without buffering
 * provider-sized failures.
 *
 * D-CORE-036: upstream delegates to `readResponseTextPrefix`
 * (`src/infra/http-body.ts`), whose closure reaches OpenClaw's gateway config
 * and request-lifecycle graph (~22k lines). Fusion carries the bounded-prefix
 * read with the same observable contract the ported channel call sites depend
 * on — byte cap, per-chunk idle timeout (default 10s), overall timeout, and a
 * cancelled + released reader — but without the lifecycle/diagnostic hooks and
 * without upstream's `onIdleTimeout` / `onTimeout` error factories: a bounded
 * read that stalls resolves with the prefix read so far instead of throwing.
 */
export async function readResponseTextLimited(
  response: Response,
  limitBytes = 16 * 1024,
  options?: { chunkTimeoutMs?: number; timeoutMs?: number },
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytesLimited(response, limitBytes, options));
}

/** The byte half of `readResponseTextLimited`, so a caller that must decode
 * fatally (a JSON body) sees the raw bytes rather than replacement characters. */
export async function readResponseBytesLimited(
  response: Response,
  limitBytes = 16 * 1024,
  options?: { chunkTimeoutMs?: number; timeoutMs?: number },
): Promise<Uint8Array> {
  if (limitBytes <= 0) {
    return new Uint8Array(0);
  }
  const body = response.body;
  if (!body) {
    return new Uint8Array(await response.arrayBuffer()).subarray(0, limitBytes);
  }
  const chunkTimeoutMs = options?.chunkTimeoutMs ?? 10_000;
  const deadline =
    options?.timeoutMs !== undefined && options.timeoutMs > 0
      ? Date.now() + options.timeoutMs
      : undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    while (read < limitBytes) {
      const remainingMs = deadline === undefined ? undefined : deadline - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        break;
      }
      const waitMs =
        remainingMs === undefined ? chunkTimeoutMs : Math.min(chunkTimeoutMs, remainingMs);
      const next = await raceWithTimeout(reader.read(), waitMs, {
        done: true as const,
        value: undefined,
      });
      if (next.done || !next.value) {
        break;
      }
      const chunk = next.value;
      const take = Math.min(chunk.length, limitBytes - read);
      chunks.push(take === chunk.length ? chunk : chunk.subarray(0, take));
      read += take;
    }
  } finally {
    await Promise.resolve(reader.cancel()).catch(() => undefined);
    reader.releaseLock();
  }
  const merged = new Uint8Array(read);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}


/**
 * Parses a provider JSON body, raising a labeled error when the payload is not
 * JSON.
 *
 * D-CORE-306: upstream's `readProviderJsonResponse`
 * (`src/agents/provider-http-errors.ts`) sits inside a 519-line module wired to
 * OpenClaw's provider request/transport config and header-redaction policy.
 * Fusion carries the observable contract the ported Discord webhook sender
 * depends on — parse the body, throw a labeled error otherwise — over the
 * bounded reader above.
 */
export async function readProviderJsonResponse<T>(
  response: Response,
  label: string,
  options?: {
    limitBytes?: number;
    /** Upstream's `ProviderResponseReadOptions` spelling of `limitBytes`. */
    maxBytes?: number;
    /** Per-chunk idle bound; a stalled provider body must not hold the caller. */
    chunkTimeoutMs?: number;
    /** Error to raise when the idle bound trips. */
    onIdleTimeout?: (params: { chunkTimeoutMs: number }) => Error;
  },
): Promise<T> {
  const limit = options?.maxBytes ?? options?.limitBytes ?? 1024 * 1024;
  const bytes = await readResponseBytesLimited(
    response,
    limit,
    options?.chunkTimeoutMs === undefined ? undefined : { chunkTimeoutMs: options.chunkTimeoutMs },
  );
  try {
    // Fatal decoding, as upstream: a body that is not valid UTF-8 is a
    // malformed response, not text with replacement characters in it.
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    throw new Error(`${label}: malformed JSON response`, { cause: error });
  }
}

/**
 * Throws a normalized provider error when a fetch response is not OK.
 *
 * D-CORE-602: upstream's `assertOkOrThrowProviderError`
 * (`src/agents/provider-http-errors.ts`) sits in a 519-line module wired to
 * OpenClaw's provider request/transport config, its header-redaction policy and
 * a `ProviderHttpError` carrying the parsed provider error `code`/`type`. Fusion
 * carries the contract the ported Zalo API client depends on — a non-OK
 * response becomes a throw whose message is `label (status): detail`, with the
 * status on the error — over the bounded reader above, so an error body cannot
 * be buffered without limit. The provider-specific `code`/`type`/`request_id`
 * extraction is NOT carried.
 */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export async function assertOkOrThrowProviderError(
  response: Response,
  label: string,
  options?: { limitBytes?: number; maxBytes?: number },
): Promise<void> {
  if (response.ok) {
    return;
  }
  const limit = options?.maxBytes ?? options?.limitBytes ?? 4 * 1024;
  let detail = "";
  try {
    detail = (await readResponseTextLimited(response, limit)).trim();
  } catch {
    detail = "";
  }
  throw new ProviderHttpError(
    `${label} (${response.status})${detail === "" ? "" : `: ${detail}`}`,
    response.status,
  );
}

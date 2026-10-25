import { offlineT } from "@/i18n/offline";

/**
 * Every Hub request settles. A company Hub behind a VPN that is off does not refuse the
 * connection; the request just never answers, and an unbounded fetch kept the Host inventory
 * "loading" forever. The deadline covers the body too, so a stalled body cannot hang a reader.
 */
export const HUB_REQUEST_TIMEOUT_MS = 15_000;

/** The Hub did not answer (offline, VPN, DNS, timeout). Never a statement about access. */
export class HubUnreachableError extends Error {
  readonly kind = "unreachable";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HubUnreachableError";
  }
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export async function fetchWithDeadline(
  url: URL | string,
  init: RequestInit,
  timeoutMs = HUB_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  // Hermes does not implement AbortSignal.timeout.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (timedOut) throw new HubUnreachableError(hubTimeoutMessage(timeoutMs), { cause: error });
    // fetch rejects only when no HTTP answer arrived: DNS, refused, TLS, offline.
    throw new HubUnreachableError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** For transports that cannot be aborted (the Electron bridge): stop waiting, not the request. */
export async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs = HUB_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HubUnreachableError(hubTimeoutMessage(timeoutMs))),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function hubTimeoutMessage(timeoutMs: number): string {
  return offlineT("hub.timedOut", { seconds: Math.round(timeoutMs / 1_000) });
}

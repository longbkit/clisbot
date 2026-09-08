// COMPAT(clisbot-channels): the shared credential-probe boundary for Channel
// Connections.
//
// Every channel Connection is probed before it is stored, so a credential that
// reaches the store is always one the provider accepted and the account can
// start with. The probes restate the vertical's own probe rather than importing
// it — the verticals are supply the loader resolves at runtime, and Hub
// production code never imports one — and each `*.test.ts` pins the restatement
// to the vertical's implementation with a differential case.
//
// One error type for all of them, because both entry points into the Channel
// plane (`channels add` and the management-api `POST /connections`) map it the
// same way: `rejected` means the provider said no (422, the operator's problem),
// anything else means the provider could not answer (502, transient).
//
// A probe never logs, returns or embeds credential material.

/** A credential the provider rejected, or a provider that could not answer. */
export class ChannelCredentialProbeError extends Error {
  constructor(
    message: string,
    readonly rejected: boolean,
  ) {
    super(message);
    this.name = "ChannelCredentialProbeError";
  }
}

/** Every probe request gets the same ceiling; a connection create must not hang. */
export const PROBE_TIMEOUT_MS = 15_000;

/**
 * One probe request. A transport failure is never `rejected`: the operator's
 * credential may be perfectly good and the network is not.
 */
export async function probeFetch(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch (error) {
    throw new ChannelCredentialProbeError(
      `the ${provider} API did not answer: ${error instanceof Error ? error.message : "unknown error"}`,
      false,
    );
  }
}

/** The response body as JSON, or `undefined` when it is not JSON at all. */
export async function probeJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => undefined);
}

/** A non-empty string field off an unknown body. */
export function readString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "string" && candidate !== "" ? candidate : undefined;
}

/** A record field off an unknown body. */
export function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate: unknown = Reflect.get(value, key);
  return candidate !== null && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : undefined;
}

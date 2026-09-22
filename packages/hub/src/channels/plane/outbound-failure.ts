// What a failed platform write means for whoever might try it again: the relay
// deciding whether to retry a final answer, and the Agent reading a `message`
// tool failure. The verticals throw their SDK's own error shapes (Slack
// `WebAPI*Error`, grammY `GrammyError`/`HttpError`, plain fetch failures), so
// this reads them structurally at the one place a write's error is caught
// (the supervisor's post seams) and the rest of the Hub reads the result.
// docs/features/channels/conversation-flow.md#outbound

export type OutboundFailureKind =
  /** The platform refused for rate; `retryAfterSeconds` says when to try again. */
  | "rate_limited"
  /** The write did not answer within the deadline; it may have landed. */
  | "timeout"
  /** The connection broke with the request in flight; it may have landed. */
  | "connection_lost"
  /** The platform failed while handling the write (Slack `fatal_error`, an
   * HTTP 500/502/504); it may have stored the message first. */
  | "server_error"
  /** The platform could not be reached or refused service; nothing landed. */
  | "unavailable"
  /** The send was split into several messages and failed after some landed. */
  | "partially_posted"
  /** The account stopped while the write waited for its turn; nothing was sent. */
  | "canceled"
  /** A newer progress message took this one's place while it waited. */
  | "superseded"
  | "channel_not_found"
  | "not_in_channel"
  | "missing_scope"
  | "not_authorized"
  /** The platform refused this message for another reason (`code`). */
  | "rejected"
  | "unknown";

export interface OutboundFailure {
  kind: OutboundFailureKind;
  /** Whether sending the same message again can succeed. */
  retryable: boolean;
  /** True when the platform may already show the message: a retry can double-post. */
  mayHavePosted: boolean;
  retryAfterSeconds?: number | undefined;
  /** The platform's own error code, when it gave one. */
  code?: string | undefined;
}

/** The Hub's deadline on every platform write (conversation-flow.md#outbound). */
export const CHANNEL_WRITE_TIMEOUT_MS = 30_000;

/** The Hub's own deadline around a write: longer than every vertical's own
 * (`CHANNEL_WRITE_TIMEOUT_MS`), so a vertical that reports a certain outcome in
 * time — a 429 it gave up waiting on — is heard before the Hub gives up. */
export const HUB_WRITE_DEADLINE_MS = CHANNEL_WRITE_TIMEOUT_MS + 10_000;

const RETRYABLE: ReadonlySet<OutboundFailureKind> = new Set([
  "rate_limited",
  "timeout",
  "connection_lost",
  "server_error",
  "unavailable",
  "canceled",
]);

const IN_FLIGHT: ReadonlySet<OutboundFailureKind> = new Set([
  "timeout",
  "connection_lost",
  "server_error",
  "partially_posted",
]);

export function outboundFailure(
  kind: OutboundFailureKind,
  detail: Pick<OutboundFailure, "retryAfterSeconds" | "code"> = {},
): OutboundFailure {
  return {
    kind,
    retryable: RETRYABLE.has(kind),
    mayHavePosted: IN_FLIGHT.has(kind),
    ...(detail.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: detail.retryAfterSeconds }),
    ...(detail.code === undefined ? {} : { code: detail.code }),
  };
}

/** Whether the relay may post a failed message again on its own: only when the
 * platform certainly did not take it and trying again can help. */
export function isSafeToRepost(failure: OutboundFailure | undefined): boolean {
  return failure !== undefined && failure.retryable && !failure.mayHavePosted;
}

/** One send's view of how many platform messages already landed. */
export interface DeliveredParts {
  /** Passed to the vertical as `onDeliveryResult`; it calls it once per message that landed. */
  onDeliveryResult(): void;
  /** Classify the send's error: after any landed part it is `partially_posted`. */
  failureOf(error: unknown): OutboundFailure;
}

/**
 * A vertical splits a long answer into several platform messages, and the
 * error it throws when a later one fails says nothing about the earlier ones.
 * Counting the parts it reports landed keeps such a send from being read as
 * "nothing posted" and sent again whole.
 */
export function trackDeliveredParts(): DeliveredParts {
  let delivered = 0;
  return {
    onDeliveryResult: () => {
      delivered += 1;
    },
    failureOf: (error) =>
      delivered > 0 ? outboundFailure("partially_posted") : classifyOutboundError(error),
  };
}

/** Slack Web API `error` codes (and their Telegram equivalents, below). */
const PLATFORM_CODES: Readonly<Record<string, OutboundFailureKind>> = {
  channel_not_found: "channel_not_found",
  not_in_channel: "not_in_channel",
  missing_scope: "missing_scope",
  not_authed: "not_authorized",
  invalid_auth: "not_authorized",
  account_inactive: "not_authorized",
  token_revoked: "not_authorized",
  token_expired: "not_authorized",
  no_permission: "not_authorized",
  ratelimited: "rate_limited",
  rate_limited: "rate_limited",
  // Slack: "it's possible some aspect of the operation succeeded before the
  // error was raised".
  internal_error: "server_error",
  fatal_error: "server_error",
  service_unavailable: "unavailable",
  request_timeout: "unavailable",
};

/** Node / undici codes for a request that never reached the platform. */
const UNREACHED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Node / undici codes for a connection that broke mid-request. */
const INTERRUPTED_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

/** Classify one thrown write error, walking its cause chain. */
export function classifyOutboundError(error: unknown): OutboundFailure {
  for (const link of causeChain(error)) {
    const failure = classifyLink(link);
    if (failure !== undefined) return failure;
  }
  return outboundFailure("unknown");
}

function classifyLink(link: Record<string, unknown>): OutboundFailure | undefined {
  return (
    partialDelivery(link) ??
    rateLimit(link) ??
    platformCode(link) ??
    telegramError(link) ??
    httpStatus(link["statusCode"]) ??
    transportFault(link)
  );
}

/** Upstream's `createChannelPartialDeliveryError`: earlier parts landed. It
 * wraps the later part's own error, so it is read before anything else. */
function partialDelivery(link: Record<string, unknown>): OutboundFailure | undefined {
  const partial = link["sentBeforeError"] === true || link["code"] === "CHANNEL_PARTIAL_DELIVERY";
  return partial ? outboundFailure("partially_posted") : undefined;
}

function rateLimit(link: Record<string, unknown>): OutboundFailure | undefined {
  const retryAfter = link["retryAfter"];
  if (typeof retryAfter !== "number") return undefined;
  return outboundFailure("rate_limited", { retryAfterSeconds: retryAfter });
}

/** Slack's `WebAPIPlatformError`: `data.error` is the method's error code. */
function platformCode(link: Record<string, unknown>): OutboundFailure | undefined {
  const data = link["data"];
  if (!isRecord(data) || typeof data["error"] !== "string") return undefined;
  const code = data["error"];
  return outboundFailure(PLATFORM_CODES[code] ?? "rejected", { code });
}

/** grammY's `GrammyError`: the Bot API's `error_code` + `description`. */
function telegramError(link: Record<string, unknown>): OutboundFailure | undefined {
  const status = link["error_code"];
  if (typeof status !== "number") return undefined;
  const description = typeof link["description"] === "string" ? link["description"] : "";
  const parameters = link["parameters"];
  const retryAfter = isRecord(parameters) ? parameters["retry_after"] : undefined;
  if (status === 429) {
    return outboundFailure("rate_limited", {
      retryAfterSeconds: typeof retryAfter === "number" ? retryAfter : undefined,
    });
  }
  const code = description === "" ? String(status) : description;
  if (/chat not found/i.test(description)) return outboundFailure("channel_not_found", { code });
  if (status === 403) return outboundFailure("not_in_channel", { code });
  if (status === 401) return outboundFailure("not_authorized", { code });
  return httpStatus(status) ?? outboundFailure("rejected", { code });
}

function httpStatus(status: unknown): OutboundFailure | undefined {
  if (typeof status !== "number") return undefined;
  if (status === 429) return outboundFailure("rate_limited");
  if (status === 503) return outboundFailure("unavailable", { code: String(status) });
  // A gateway error can come back after the platform stored the message.
  if (status >= 500) return outboundFailure("server_error", { code: String(status) });
  return undefined;
}

function transportFault(link: Record<string, unknown>): OutboundFailure | undefined {
  const name = link["name"];
  if (name === "TimeoutError" || name === "ChannelWriteTimeoutError") {
    return outboundFailure("timeout");
  }
  const code = link["code"];
  if (typeof code !== "string") return undefined;
  if (UNREACHED_CODES.has(code)) return outboundFailure("unavailable", { code });
  if (INTERRUPTED_CODES.has(code)) return outboundFailure("connection_lost", { code });
  return undefined;
}

/** The error and what it wraps: `cause` (standard), `original` (Slack's
 * request error), `error` (grammY's `HttpError`). Bounded against cycles. */
function causeChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  while (isRecord(current) && chain.length < 8 && !chain.includes(current)) {
    chain.push(current);
    current = current["cause"] ?? current["original"] ?? current["error"];
  }
  return chain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/**
 * Hub-owned non-retryable classification for the durable ingress drain.
 *
 * Upstream keeps this out of core on purpose ("Channel-specific non-retryable
 * classification stays out of core; pass it in" —
 * `src/channels/message/ingress-retry-policy.ts`) and each channel supplies its
 * own predicate (`extensions/telegram/src/telegram-ingress-non-retryable.ts`).
 * In Fusion the Hub owns route/agent resolution, so the errors that can never
 * succeed on replay are Hub errors, not channel errors. The drain still accepts
 * an override so a vertical can add its own classes later.
 */
import { createChannelIngressError } from "@getpaseo/channels-core/channels/message/ingress-errors";
import type { IngressNonRetryableFailure } from "@getpaseo/channels-core/channels/message/ingress-retry-policy";

/** A stored ingress payload that cannot be decoded into an inbound event. */
export const ChannelIngressPayloadError = createChannelIngressError("ChannelIngressPayloadError");

/**
 * Error names whose failure is a fact about the stored event or the account's
 * configuration. Retrying replays the same input against the same config, so
 * the only useful outcome is an operator-visible dead-letter.
 */
const NON_RETRYABLE_BY_ERROR_NAME: ReadonlyMap<string, string> = new Map([
  ["ChannelIngressPayloadError", "invalid-event"],
  ["ChannelAgentSpecError", "missing-agent-harness"],
  ["ChannelWorkflowTargetError", "missing-agent-harness"],
  ["ChannelCompilationError", "invalid-account-config"],
  ["ChannelsDisabledError", "channels-disabled"],
]);

function errorCandidates(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    seen.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return seen;
}

/** Resolve the Hub's non-retryable reason for a dispatch error, or null. */
export function resolveHubIngressNonRetryableFailure(
  error: unknown,
): IngressNonRetryableFailure | null {
  for (const candidate of errorCandidates(error)) {
    if (!(candidate instanceof Error)) continue;
    const reason = NON_RETRYABLE_BY_ERROR_NAME.get(candidate.name);
    if (reason !== undefined) return { reason, message: candidate.message };
  }
  return null;
}

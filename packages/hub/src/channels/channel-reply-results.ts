// The `CallToolResult` shapes every channel-reply tool verb answers with.
//
// One home so a refusal reads the same whether it came from the action gate,
// the send path, or a vertical's own tool: a short line of text the model reads,
// plus structured content when the caller has facts to report.

import { formatErrorMessage } from "@getpaseo/channels-core/infra/errors";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OutboundFailure } from "./plane/outbound-failure.js";

export function toolSuccess(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

export function toolFailure(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** A schema-visible action no Hub seam and no channel adapter can run. */
export function unsupportedAction(action: string, reason: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text: `unsupported action ${action}: ${reason}` }],
    structuredContent: { status: "unsupported_action", action, reason },
    isError: true,
  };
}

/**
 * A failed `message` send, as the line the model reads: the reason, then
 * whether sending again can help. The same facts are in `structuredContent.failure`.
 */
export function failedSendText(reason: string, failure: OutboundFailure | undefined): string {
  const text = `message post failed: ${reason}`;
  if (failure === undefined) return text;
  return `${text} (${failure.kind}: ${retryAdvice(failure)})`;
}

function retryAdvice(failure: OutboundFailure): string {
  if (failure.kind === "partially_posted") {
    return "part of the message is already in the conversation; send only what is missing";
  }
  if (failure.mayHavePosted) {
    return "the message may already be in the conversation; check before sending it again";
  }
  if (!failure.retryable) return "sending it again will not help";
  if (failure.retryAfterSeconds !== undefined) {
    return `sending it again after ${failure.retryAfterSeconds}s can succeed`;
  }
  return "sending it again later can succeed";
}

/**
 * One error, as tool output.
 *
 * Everything on these paths came from a channel vertical's HTTP client, and
 * those messages routinely quote the request that failed — bot token in the
 * path, `Authorization` header, signed URL. The ported formatter masks the
 * credentials, so no channel error reaches the model or `structuredContent`
 * with a live secret in it.
 */
export function errorText(error: unknown): string {
  return formatErrorMessage(error);
}

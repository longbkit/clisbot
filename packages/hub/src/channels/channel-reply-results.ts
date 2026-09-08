// The `CallToolResult` shapes every channel-reply tool verb answers with.
//
// One home so a refusal reads the same whether it came from the action gate,
// the send path, or a vertical's own tool: a short line of text the model reads,
// plus structured content when the caller has facts to report.

import { formatErrorMessage } from "@getpaseo/channels-core/infra/errors";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

// upstream: src/infra/outbound/message-action-param-keys.ts@5d8067a4483
// Message-action param key screening prevents plugin discovery when only
// standard send/media/threading params are present.
import { normalizeOptionalString } from "../../normalization-core/string-coerce.js";

const STANDARD_MESSAGE_ACTION_PARAM_KEYS = new Set([
  "accountId",
  "action",
  "asDocument",
  "attachments",
  "base64",
  "bestEffort",
  "buffer",
  "caption",
  "channel",
  "channelId",
  "contentType",
  "delivery",
  "dryRun",
  "filePath",
  "fileUrl",
  "filename",
  "forceDocument",
  "gifPlayback",
  "gatewayToken",
  "gatewayUrl",
  "image",
  "idempotencyKey",
  "interactive",
  "json",
  "media",
  "mediaUrl",
  "mediaUrls",
  "media_urls",
  "message",
  "mimeType",
  "path",
  "pollAnonymous",
  "pollDurationHours",
  "pollMulti",
  "pollOption",
  "pollPublic",
  "pollQuestion",
  "pin",
  "presentation",
  "replyTo",
  "silent",
  "senderIsOwner",
  "target",
  "targets",
  "text",
  "threadId",
  "timeoutMs",
  "topLevel",
  "to",
]);

/**
 * Detects non-standard message action params that may need plugin-owned handling.
 */
export function hasPotentialPluginActionParam(params: Record<string, unknown>): boolean {
  return Object.entries(params).some(([key, value]) => {
    if (STANDARD_MESSAGE_ACTION_PARAM_KEYS.has(key)) {
      return false;
    }
    if (typeof value === "string") {
      return Boolean(normalizeOptionalString(value));
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    return value !== undefined;
  });
}

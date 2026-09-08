// upstream: extensions/slack/src/send-results.ts@5d8067a4483
import { createMessageReceiptFromOutboundResults } from "@getpaseo/channels-core/plugin-sdk/channel-outbound";
import type { SlackSendResult } from "./send.js";

export function mergeSlackSendResults(results: readonly SlackSendResult[]): SlackSendResult {
  const lastResult = results.at(-1);
  if (!lastResult) {
    throw new Error("Slack send plan produced no delivery.");
  }
  if (results.length === 1) {
    return lastResult;
  }
  // A logical send can span media, rendered segments, and nested text chunks.
  // Keep every accepted ID while retaining the legacy final-message scalar fields.
  const receipt = createMessageReceiptFromOutboundResults({ results });
  receipt.parts = receipt.parts.map((part, index) => ({ ...part, index }));
  const questionResult = results.find((result) => result.meta?.slackQuestionActionIds.length);
  return {
    ...lastResult,
    receipt,
    ...(questionResult?.meta
      ? {
          meta: {
            ...questionResult.meta,
            slackQuestionMessageId:
              questionResult.meta.slackQuestionMessageId ?? questionResult.messageId,
          },
        }
      : {}),
  };
}

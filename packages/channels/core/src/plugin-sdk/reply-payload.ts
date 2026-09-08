// upstream: src/plugin-sdk/reply-payload.ts@5d8067a4483
// D-CORE-001: the upstream plugin-sdk barrel also re-exports the media payload
// builders, the ask-user option indices, the outbound reply-payload normalizer,
// the reply-to fanout policy and the plugin-facing `OutboundReplyPayload` shape.
// The ported message-action layer reads the sendable-parts helpers; those come
// from the carried `infra/outbound/reply-payload-parts.ts` source module.
export {
  countOutboundMedia,
  hasOutboundMedia,
  hasOutboundText,
  resolveOutboundMediaUrls,
  resolveSendableOutboundReplyParts,
} from "../infra/outbound/reply-payload-parts.js";
import type { ReplyPayload } from "../auto-reply/reply-payload.js";
export type { ReplyPayload };

// Slice 10b additions (Slack send/blocks port): the ask-user option-index
// readers and the chunk fallback the ported Slack send path calls. Upstream
// declares all three in this barrel; they are carried with upstream's bodies.

/** Per-question map of lowercased option value to its rendered index. */
export type AskUserQuestionOptionIndices = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Read bounded Gateway-owned option ordering for one native ask_user question. */
export function resolveAskUserQuestionOptionIndices(
  payload: Pick<ReplyPayload, "channelData">,
): AskUserQuestionOptionIndices | undefined {
  const askUser = payload.channelData?.askUser;
  if (!askUser || typeof askUser !== "object" || Array.isArray(askUser)) {
    return undefined;
  }
  // SAFETY: channelData.askUser is an internal record after the object and array checks above.
  const { questionId, optionValues } = askUser as {
    questionId?: unknown;
    optionValues?: unknown;
  };
  if (
    typeof questionId !== "string" ||
    !questionId ||
    !Array.isArray(optionValues) ||
    optionValues.length < 2 ||
    optionValues.length > 4
  ) {
    return undefined;
  }

  const optionIndices = new Map<string, number>();
  for (const [optionIndex, optionValue] of optionValues.entries()) {
    if (typeof optionValue !== "string") {
      return undefined;
    }
    const normalizedOptionValue = optionValue.trim().toLowerCase();
    if (!normalizedOptionValue || optionIndices.has(normalizedOptionValue)) {
      return undefined;
    }
    optionIndices.set(normalizedOptionValue, optionIndex);
  }
  return new Map([[questionId, optionIndices]]);
}

/** Match one presented choice to its Gateway-owned option index. */
export function resolveAskUserQuestionOptionIndex(params: {
  questionOptionIndices?: AskUserQuestionOptionIndices;
  questionId: string;
  optionValue: string;
}): number | undefined {
  return params.questionOptionIndices
    ?.get(params.questionId)
    ?.get(params.optionValue.trim().toLowerCase());
}

export function resolveTextChunksWithFallback(text: string, chunks: readonly string[]): string[] {
  if (chunks.length > 0) {
    return [...chunks];
  }
  if (!text) {
    return [];
  }
  return [text];
}

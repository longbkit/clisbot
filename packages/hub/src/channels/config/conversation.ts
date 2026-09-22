// The conversation leaves of `defaults:` — what an Agent is given beside the
// message that triggers it, and when that message is sent
// (docs/features/channels/conversation-flow.md#configuration):
//
//   interaction.whenBusy   steer | queue
//   context.unmentioned    everyone | allowed-senders | none
//   context.maxMessages    how many earlier messages ride along
//   batching               off | { pauseSeconds, maxWaitSeconds, maxMessages }
//
// Like `questions` and `agentControls`, every leaf is ABSENT from the compiled
// defaults until a layer authors it: a route's compiled block is hashed into
// `routeFingerprint`, and a floor value would rewrite every fingerprint on
// upgrade. The floors are applied where the leaves are read
// (`conversationSettings`).

import { z } from "zod";
import { ContextUnmentionedSchema, type ContextUnmentioned, type WhenBusy } from "./enums.js";

/** The ceiling on `context.maxMessages`: every kept message is prompt text. */
export const CONTEXT_MAX_MESSAGES_CEILING = 200;

export const ContextDefaultsSchema = z
  .object({
    unmentioned: ContextUnmentionedSchema.optional(),
    maxMessages: z
      .number()
      .int()
      .min(0)
      .max(CONTEXT_MAX_MESSAGES_CEILING, {
        error: `context.maxMessages is at most ${String(CONTEXT_MAX_MESSAGES_CEILING)}`,
      })
      .optional(),
  })
  .strict();
export type ContextDefaults = z.infer<typeof ContextDefaultsSchema>;

/** A batching window. All three leaves are authored together: the block is
 * taken whole from the most specific layer, so `batching: off` on a Route
 * turns off what its account turned on. */
export const BatchingWindowSchema = z
  .object({
    pauseSeconds: z.number().positive({ error: "batching.pauseSeconds must be greater than 0" }),
    maxWaitSeconds: z.number().positive(),
    maxMessages: z.number().int().min(1, { error: "batching.maxMessages must be at least 1" }),
  })
  .strict()
  .refine((window) => window.maxWaitSeconds > window.pauseSeconds, {
    error: "batching.maxWaitSeconds must be greater than batching.pauseSeconds",
    path: ["maxWaitSeconds"],
  });
export type BatchingWindow = z.infer<typeof BatchingWindowSchema>;

export const BatchingSchema = z.union([z.literal("off"), BatchingWindowSchema], {
  error: "batching must be `off` or { pauseSeconds, maxWaitSeconds, maxMessages }",
});
export type Batching = z.infer<typeof BatchingSchema>;

/** The floors: steer into a running turn, keep everyone's unmentioned messages,
 * 20 of them, no batching. */
export const CONVERSATION_FLOOR = {
  whenBusy: "steer",
  context: { unmentioned: "everyone", maxMessages: 20 },
  batching: "off",
} as const;

/** The conversation leaves as the fold leaves them: each ABSENT until authored. */
export interface EffectiveConversationDefaults {
  whenBusy?: WhenBusy | undefined;
  context?: { unmentioned?: ContextUnmentioned; maxMessages?: number } | undefined;
  batching?: Batching | undefined;
}

/** The conversation leaves with their floors applied: what the plane reads. */
export interface ConversationSettings {
  whenBusy: WhenBusy;
  context: { unmentioned: ContextUnmentioned; maxMessages: number };
  /** Undefined = batching is off. */
  batching: BatchingWindow | undefined;
}

type ConversationLayer =
  | {
      interaction?: { whenBusy?: WhenBusy | undefined } | undefined;
      context?: ContextDefaults | undefined;
      batching?: Batching | undefined;
    }
  | undefined;

type LeafPicker = <T>(leaf: (layer: ConversationLayer) => T | undefined) => T | undefined;

/** Fold the conversation leaves through the layer chain (most specific wins
 * per leaf; `batching` is one block). Unauthored leaves stay absent. */
export function foldConversationDefaults(pick: LeafPicker): EffectiveConversationDefaults {
  const whenBusy = pick((layer) => layer?.interaction?.whenBusy);
  const unmentioned = pick((layer) => layer?.context?.unmentioned);
  const maxMessages = pick((layer) => layer?.context?.maxMessages);
  const batching = pick((layer) => layer?.batching);
  const context = {
    ...(unmentioned === undefined ? {} : { unmentioned }),
    ...(maxMessages === undefined ? {} : { maxMessages }),
  };
  return {
    ...(whenBusy === undefined ? {} : { whenBusy }),
    ...(Object.keys(context).length === 0 ? {} : { context }),
    ...(batching === undefined ? {} : { batching }),
  };
}

/** The conversation settings a Route runs with: authored leaves over the floors. */
export function conversationSettings(
  defaults: EffectiveConversationDefaults,
): ConversationSettings {
  const batching = defaults.batching ?? CONVERSATION_FLOOR.batching;
  return {
    whenBusy: defaults.whenBusy ?? CONVERSATION_FLOOR.whenBusy,
    context: {
      unmentioned: defaults.context?.unmentioned ?? CONVERSATION_FLOOR.context.unmentioned,
      maxMessages: defaults.context?.maxMessages ?? CONVERSATION_FLOOR.context.maxMessages,
    },
    batching: batching === "off" ? undefined : batching,
  };
}

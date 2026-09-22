import {
  CONTEXT_MAX_MESSAGES_CEILING,
  DEFAULT_CHANNEL_BATCHING,
  isContextMaxMessages,
  readChannelRouteConversation,
  type ChannelRouteBatching,
  type ChannelRouteConversation,
  type ChannelRouteUnmentioned,
  type ChannelRouteWhenBusy,
  type EffectiveChannelRouteConversation,
} from "../channel-route-conversation";

// The Route form's Conversation context section as a plain model: the draft
// opens from the stored Route and what it inherits, commands return the next
// draft, and `parseRouteConversationDraft` gives the leaves a save writes.
// A leaf the Route does not author shows the inherited value and writes
// nothing until the user changes it, like the follow-up and questions leaves.

export type BatchingFieldName = keyof ChannelRouteBatching;
export type BatchingFieldsDraft = Record<BatchingFieldName, string>;

export interface RouteConversationDraft {
  inherited: EffectiveChannelRouteConversation;
  whenBusy?: ChannelRouteWhenBusy;
  unmentioned?: ChannelRouteUnmentioned;
  /** Typed text for `context.maxMessages`; absent inherits. */
  maxMessages?: string;
  /** The Route's own switch; absent inherits. */
  batching?: "off" | "on";
  /** The batching rows as typed; absent shows the inherited or starting values. */
  batchingFields?: BatchingFieldsDraft;
}

export type BatchingErrors = Partial<Record<BatchingFieldName, string>>;
export interface RouteConversationErrors {
  maxMessages?: string;
  batching: BatchingErrors;
}

export type ParsedRouteConversation =
  | { valid: true; value: ChannelRouteConversation; errors: RouteConversationErrors }
  | { valid: false; errors: RouteConversationErrors };

const WHOLE_NUMBER_ERROR = "Use a positive whole number.";
const CONTEXT_MESSAGES_ERROR = `Use a whole number from 0 to ${String(CONTEXT_MAX_MESSAGES_CEILING)}.`;
const SECONDS_ERROR = "Use a number of seconds above 0.";
const MAX_WAIT_ERROR = "Must be longer than the pause.";

/**
 * Opens the draft from the stored Route and what it inherits
 * (`inheritedChannelRouteConversation` over the organization's and the
 * account's `defaults:`).
 */
export function openRouteConversationDraft(
  route: Record<string, unknown> | undefined,
  inherited: EffectiveChannelRouteConversation,
): RouteConversationDraft {
  const { whenBusy, unmentioned, maxMessages, batching } = readChannelRouteConversation(route);
  return {
    inherited,
    ...(whenBusy === undefined ? {} : { whenBusy }),
    ...(unmentioned === undefined ? {} : { unmentioned }),
    ...(maxMessages === undefined ? {} : { maxMessages: String(maxMessages) }),
    ...(batching === undefined ? {} : { batching: batching === "off" ? "off" : "on" }),
    ...(batching === undefined || batching === "off"
      ? {}
      : { batchingFields: batchingFieldsDraft(batching) }),
  };
}

/** What the section shows: the Route's own value, or the one it inherits. */
export function routeConversationDisplay(draft: RouteConversationDraft) {
  const { inherited } = draft;
  const batchingOn =
    draft.batching === undefined ? inherited.batching !== "off" : draft.batching === "on";
  return {
    whenBusy: draft.whenBusy ?? inherited.whenBusy,
    unmentioned: draft.unmentioned ?? inherited.unmentioned,
    maxMessages: draft.maxMessages ?? String(inherited.maxMessages),
    batchingOn,
    batchingFields: shownBatchingFields(draft),
    /** Advanced holds a value the Route authors, so it opens on its own. */
    advancedInUse: draft.batching !== undefined || draft.whenBusy !== undefined,
  };
}

export function setRouteBatchingOn(
  draft: RouteConversationDraft,
  on: boolean,
): RouteConversationDraft {
  // Turning batching on starts from the rows already shown or typed.
  return { ...draft, batching: on ? "on" : "off", batchingFields: shownBatchingFields(draft) };
}

/** Typing in a row overrides batching on the Route, even when it was inherited on. */
export function setRouteBatchingField(
  draft: RouteConversationDraft,
  name: BatchingFieldName,
  text: string,
): RouteConversationDraft {
  return {
    ...draft,
    batching: "on",
    batchingFields: { ...shownBatchingFields(draft), [name]: text },
  };
}

export function parseRouteConversationDraft(
  draft: RouteConversationDraft,
): ParsedRouteConversation {
  const maxMessages =
    draft.maxMessages === undefined ? undefined : contextMaxMessages(draft.maxMessages);
  const maxMessagesInvalid = draft.maxMessages !== undefined && maxMessages === undefined;
  const batching = draft.batching === "on" ? parseBatching(shownBatchingFields(draft)) : null;
  const errors: RouteConversationErrors = {
    ...(maxMessagesInvalid ? { maxMessages: CONTEXT_MESSAGES_ERROR } : {}),
    batching: batching !== null && !batching.valid ? batching.errors : {},
  };
  if (maxMessagesInvalid || (batching !== null && !batching.valid)) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    errors,
    value: {
      ...(draft.whenBusy === undefined ? {} : { whenBusy: draft.whenBusy }),
      ...(draft.unmentioned === undefined ? {} : { unmentioned: draft.unmentioned }),
      ...(maxMessages === undefined ? {} : { maxMessages }),
      ...(draft.batching === "off" ? { batching: "off" as const } : {}),
      ...(batching?.valid ? { batching: batching.value } : {}),
    },
  };
}

function parseBatching(
  fields: BatchingFieldsDraft,
): { valid: true; value: ChannelRouteBatching } | { valid: false; errors: BatchingErrors } {
  const pauseSeconds = seconds(fields.pauseSeconds);
  const maxWaitSeconds = seconds(fields.maxWaitSeconds);
  const maxMessages = wholeNumber(fields.maxMessages);
  const errors: BatchingErrors = {
    ...(pauseSeconds === undefined ? { pauseSeconds: SECONDS_ERROR } : {}),
    ...(maxWaitSeconds === undefined ? { maxWaitSeconds: SECONDS_ERROR } : {}),
    ...(pauseSeconds !== undefined && maxWaitSeconds !== undefined && maxWaitSeconds <= pauseSeconds
      ? { maxWaitSeconds: MAX_WAIT_ERROR }
      : {}),
    ...(maxMessages === undefined ? { maxMessages: WHOLE_NUMBER_ERROR } : {}),
  };
  if (pauseSeconds === undefined || maxWaitSeconds === undefined || maxMessages === undefined) {
    return { valid: false, errors };
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, value: { pauseSeconds, maxWaitSeconds, maxMessages } };
}

function shownBatchingFields(draft: RouteConversationDraft): BatchingFieldsDraft {
  if (draft.batchingFields !== undefined) return draft.batchingFields;
  const { batching } = draft.inherited;
  return batchingFieldsDraft(batching === "off" ? DEFAULT_CHANNEL_BATCHING : batching);
}

function batchingFieldsDraft(batching: ChannelRouteBatching): BatchingFieldsDraft {
  return {
    pauseSeconds: String(batching.pauseSeconds),
    maxWaitSeconds: String(batching.maxWaitSeconds),
    maxMessages: String(batching.maxMessages),
  };
}

/** Seconds typed as text: a number above 0 (the Hub takes fractions), or undefined. */
function seconds(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 ? value : undefined;
}

/** `context.maxMessages` typed as text, or undefined. */
function contextMaxMessages(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return isContextMaxMessages(value) ? value : undefined;
}

/** A positive whole number typed as text, or undefined. */
function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

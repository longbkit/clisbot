// The follow-up policy (implementation doc §4.3.4): whether an unmentioned
// message continues a bound session. It is a refinement of `requireMention` —
// a route that does not require a mention admits every message — and the
// conversation's `/followup` override replaces the Route's mode.
import type { ChannelStore } from "../../db/channels.js";
import type { ChannelConversationKey } from "../../db/channel-access.js";
import type { CompiledRoute, EffectiveDefaults } from "../config/compile.js";
import type { FollowUpMode } from "../config/enums.js";
import type { InboundMessage } from "../plane/types.js";
import { deriveBindingKey } from "./stored-route.js";

/** A follow-up admission result over a bound session. */
export interface FollowUpAdmission {
  allowed: boolean;
  reason?: string | undefined;
}

/** The key a conversation's `/followup` override is stored against: its binding key. */
export function followUpConversationKey(
  organizationId: string,
  message: InboundMessage,
  route: CompiledRoute,
): ChannelConversationKey {
  return {
    organizationId,
    channel: message.channel,
    accountId: message.accountId,
    ...deriveBindingKey(message, route),
  };
}

/**
 * The follow-up mode an unmentioned message meets in a bound conversation.
 * Read only when it can decide something: a mention, or a route that does not
 * require one, is admitted whatever the mode. `paused` reads as `mention-only`.
 */
export async function conversationFollowUpMode(
  store: Pick<ChannelStore, "access"> | undefined,
  organizationId: string,
  message: InboundMessage,
  route: CompiledRoute,
): Promise<FollowUpMode> {
  const routeMode = route.defaults.followUp.mode;
  if (store === undefined || message.mentionedBot || !route.defaults.requireMention) {
    return routeMode;
  }
  const override = await store.access.findConversationFollowUp(
    followUpConversationKey(organizationId, message, route),
  );
  if (override === undefined) return routeMode;
  return override.mode === "paused" ? "mention-only" : override.mode;
}

/**
 * End `/followup pause` once a mention has been accepted — after admission,
 * authorization and route limits — so a refused or throttled mention leaves the
 * pause in place. Returns the conversation to the Route's mode.
 */
export async function endFollowUpPause(
  store: Pick<ChannelStore, "access"> | undefined,
  organizationId: string,
  message: InboundMessage,
  route: CompiledRoute,
): Promise<void> {
  if (store === undefined || !message.mentionedBot || !route.defaults.requireMention) return;
  await store.access.clearPausedConversationFollowUp(
    followUpConversationKey(organizationId, message, route),
  );
}

/**
 * Admit a follow-up into a bound session. A mention always steers, and so does
 * every message on a route that does not require a mention. Otherwise an
 * unmentioned follow-up steers only in `auto` mode while the session is inside
 * its `ttlMinutes` window; `mention-only` always needs a new mention.
 */
export function admitFollowUp(
  message: { mentionedBot: boolean },
  defaults: EffectiveDefaults,
  idle: boolean,
  mode: FollowUpMode = defaults.followUp.mode,
): FollowUpAdmission {
  if (message.mentionedBot || !defaults.requireMention) return { allowed: true };
  if (mode === "mention-only") {
    return { allowed: false, reason: "a mention is required for every message here" };
  }
  if (idle) {
    return { allowed: false, reason: "follow-up window ended; mention the bot to continue" };
  }
  return { allowed: true };
}

// The sender-admission gate: upstream's `dmPolicy` / `groupPolicy` /
// `allowFrom` / `groupAllowFrom` decision, run by the Hub before a turn starts.
//
// The decision itself is NOT re-implemented here. `resolveDmGroupAccessWithLists`
// is the ported OpenClaw function (`@getpaseo/channels-core/security/dm-policy-shared`,
// upstream `src/security/dm-policy-shared.ts`), and the sender match is
// upstream's `resolveAllowlistMatchSimple` (`channels/allowlist-match.ts`). This
// module only supplies the three things upstream reads from its own config and
// its own SQLite store, and that the Hub owns instead:
//
//   1. the effective `access:` block, folded org < account < route by the
//      compiler rather than read off `channels.<channel>.accounts.<id>`;
//   2. `storeAllowFrom` — the senders an operator approved in `channel_pairings`,
//      where upstream reads its pairing store;
//   3. whether the conversation is a group, from the plane's own conversation
//      descriptor rather than the platform's raw chat type.
//
// This gate runs IN FRONT of the Hub's RBAC gate (`policy.mayTrigger`), never
// instead of it: both must allow. A revision that authored no `access:` block
// has no `EffectiveAccess`, so the gate does not run at all and admission is
// exactly what it was before the knob existed.
import { resolveAllowlistMatchSimple } from "@getpaseo/channels-core/channels/allowlist-match";
import {
  DM_GROUP_ACCESS_REASON,
  resolveDmGroupAccessWithLists,
  type DmGroupAccessDecision,
  type DmGroupAccessReasonCode,
} from "@getpaseo/channels-core/security/dm-policy-shared";
import type { EffectiveAccess } from "../config/compile.js";
import type { InboundMessage } from "../plane/types.js";

export { DM_GROUP_ACCESS_REASON };
export type { DmGroupAccessDecision, DmGroupAccessReasonCode };

/** What the access gate decided about one sender. */
export interface ChannelAccessDecision {
  decision: DmGroupAccessDecision;
  reasonCode: DmGroupAccessReasonCode;
  /** Upstream's human wording (`groupPolicy=allowlist (not allowlisted)`). */
  reason: string;
}

/** A conversation is "group" for policy whenever it is not a direct message —
 * a Slack channel, a Telegram group or topic, a thread inside either. Upstream
 * makes the same two-way split (`isGroup`); the Hub's route-match vocabulary is
 * finer, so this is the one place the two are reconciled. */
export function isGroupConversation(conversation: InboundMessage["conversation"]): boolean {
  return conversation.kind !== "dm";
}

/**
 * The sender's native id, as `allowFrom` entries name them. The plane carries
 * `<channel>:<provider-id>`; upstream allowlists carry the bare provider id, and
 * an operator copying an id out of Slack or Telegram writes the bare form. Both
 * spellings match, because the prefixed form is only ever a strict prefix away.
 */
export function accessSenderIds(message: InboundMessage): { senderId: string; prefixed: string } {
  const prefix = `${message.channel}:`;
  return {
    senderId: message.senderIdentity.startsWith(prefix)
      ? message.senderIdentity.slice(prefix.length)
      : message.senderIdentity,
    prefixed: message.senderIdentity,
  };
}

/**
 * Run the upstream decision for one inbound message.
 *
 * `storeAllowFrom` is the operator-approved pairing list; upstream merges it
 * into the DM allowlist only under `dmPolicy: pairing` (that rule lives in the
 * ported `mergeDmAllowFromSources`, not here).
 */
export function evaluateChannelAccess(input: {
  access: EffectiveAccess;
  message: InboundMessage;
  storeAllowFrom: readonly string[];
}): ChannelAccessDecision {
  const ids = accessSenderIds(input.message);
  const access = input.access;
  const result = resolveDmGroupAccessWithLists({
    isGroup: isGroupConversation(input.message.conversation),
    dmPolicy: access.dmPolicy ?? null,
    groupPolicy: access.groupPolicy ?? null,
    allowFrom: access.allowFrom === undefined ? null : [...access.allowFrom],
    groupAllowFrom: access.groupAllowFrom === undefined ? null : [...access.groupAllowFrom],
    storeAllowFrom: [...input.storeAllowFrom],
    groupAllowFromFallbackToAllowFrom: access.groupAllowFromFallbackToAllowFrom ?? null,
    isSenderAllowed: (allowFrom) =>
      resolveAllowlistMatchSimple({ allowFrom, senderId: ids.senderId }).allowed ||
      resolveAllowlistMatchSimple({ allowFrom, senderId: ids.prefixed }).allowed,
  });
  return { decision: result.decision, reasonCode: result.reasonCode, reason: result.reason };
}

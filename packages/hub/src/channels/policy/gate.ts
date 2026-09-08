// The access gate as the plane drives it: evaluate, mint a pairing request when
// the policy asks for one, and say what the sender should be told.
//
// Split from `execution.ts` so the plane keeps one call site and this file keeps
// the whole decision. Nothing here posts or records — the gate returns what
// happened and the plane owns the channel and the audit trail, which is what
// lets the gate be tested without a channel or a database.
import type { ChannelPrivilegeDecision } from "../../access/store.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
} from "../config/compile.js";
import type { ChannelAccessStore } from "../../db/channel-access.js";
import type { ChannelUseAuthorizer, InboundMessage, SupportedChannelName } from "../plane/types.js";
import { externalParticipantMayTrigger, mayTrigger } from "../policy.js";
import { evaluateChannelAccess, type DmGroupAccessReasonCode } from "./access.js";
import { mintPairingCode, pairingChallengeText } from "./pairing.js";

/** What the gate decided, and what (if anything) to say. */
export type ChannelAccessGateOutcome =
  | { kind: "allow" }
  | {
      kind: "deny";
      reasonCode: DmGroupAccessReasonCode;
      reason: string;
      /** The route's `access.deniedReply`; absent = refuse silently. */
      reply?: string | undefined;
    }
  | {
      kind: "pairing";
      reasonCode: DmGroupAccessReasonCode;
      reason: string;
      code: string;
      /** Absent on every repeat of the same request: the sender was already
       * shown this code, so the plane stays silent instead of answering each
       * message with the same challenge. */
      reply?: string | undefined;
    };

/**
 * Run the route's `access:` block for one inbound message.
 *
 * A route with no `access:` block allows everything here — the gate did not
 * run, and the RBAC gate behind it is unchanged. That is what keeps every
 * revision authored before this knob existed behaving exactly as it did.
 */
export async function admitChannelAccess(input: {
  store: ChannelAccessStore;
  organizationId: string;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  message: InboundMessage;
}): Promise<ChannelAccessGateOutcome> {
  const access = input.route.defaults.access;
  if (access === undefined) return { kind: "allow" };
  const accountKey = {
    organizationId: input.organizationId,
    channel: input.account.channel as SupportedChannelName,
    accountId: input.account.accountId,
  };
  const storeAllowFrom = await input.store.listApprovedPairedSenders(accountKey);
  const decision = evaluateChannelAccess({
    access,
    message: input.message,
    storeAllowFrom,
  });
  if (decision.decision === "allow") return { kind: "allow" };
  if (decision.decision === "block") {
    return {
      kind: "deny",
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      ...(access.deniedReply === undefined ? {} : { reply: access.deniedReply }),
    };
  }
  const { record, created } = await input.store.requestPairing({
    ...accountKey,
    senderIdentity: input.message.senderIdentity,
    ...(input.message.senderName === undefined ? {} : { senderName: input.message.senderName }),
    externalConversationId: input.message.conversation.rootConversationId,
    code: mintPairingCode(),
  });
  // A denied request never re-challenges: an operator already said no, and
  // handing the sender a fresh code would make "deny" mean "ask again".
  if (record.status === "denied") {
    return {
      kind: "deny",
      reasonCode: decision.reasonCode,
      reason: "pairing request denied",
      ...(access.deniedReply === undefined ? {} : { reply: access.deniedReply }),
    };
  }
  return {
    kind: "pairing",
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    code: record.code,
    ...(created ? { reply: pairingChallengeText(record.code) } : {}),
  };
}

/**
 * The one "may this sender use this route" decision, shared by the plane facade
 * and the bindings engine so neither can drift from the other.
 *
 * Four ways in, in order: the route opened its audience; the sender's roles
 * grant `bot.interact`; the route authored an `access:` block and it admits
 * them (this is what makes pairing mean something — an operator-approved
 * stranger has no Hub identity and no role, and approval is the grant); or the
 * Hub's own access store says yes. A sender the access gate REFUSES never gets
 * here: `admitChannelAccess` settles the message in the plane first.
 */
export async function mayUseChannelRoute(input: {
  store?: ChannelAccessStore | undefined;
  organizationId: string;
  controlPlane: ChannelControlPlane;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  message: InboundMessage;
  authorizeChannelUse?: ChannelUseAuthorizer | undefined;
}): Promise<ChannelPrivilegeDecision> {
  const { account, controlPlane, message, route } = input;
  if (externalParticipantMayTrigger(message, route)) return { allowed: true };
  if (mayTrigger(message.senderIdentity, controlPlane, account, route)) return { allowed: true };
  if (route.defaults.access !== undefined && input.store !== undefined) {
    const storeAllowFrom = await input.store.listApprovedPairedSenders({
      organizationId: input.organizationId,
      channel: account.channel as SupportedChannelName,
      accountId: account.accountId,
    });
    const decision = evaluateChannelAccess({
      access: route.defaults.access,
      message,
      storeAllowFrom,
    });
    if (decision.decision === "allow") return { allowed: true };
  }
  return (
    (await input.authorizeChannelUse?.({
      organizationId: input.organizationId,
      account,
      message,
    })) ?? { allowed: false, reason: "sender may not trigger this route" }
  );
}

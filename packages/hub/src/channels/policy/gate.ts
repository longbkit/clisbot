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
import type {
  ChannelSenderResolver,
  InboundMessage,
  SupportedChannelName,
} from "../plane/types.js";
import {
  needsSenderFacts,
  type AudienceSender,
  type CompiledAudienceRule,
} from "../config/audience.js";
import { admittingRules, mayTrigger } from "../policy.js";
import { rulesFor } from "../rule-trigger.js";
import { evaluateChannelAccess, type DmGroupAccessReasonCode } from "./access.js";
import { mintPairingCode, pairingChallengeText } from "./pairing.js";

/**
 * Whether the sender may use the Route. Admitted by the Route's rules, it
 * names them: their conditions (a mention, the follow-up window) decide the
 * message (`rule-trigger.ts`). Admitted another way (a role assignment, the
 * legacy `access:` block), `rules` is absent and the conversation's apply.
 */
export type ChannelRouteAdmission =
  | { allowed: true; rules?: readonly CompiledAudienceRule[] }
  | Extract<ChannelPrivilegeDecision, { allowed: false }>;

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
 * The sender as the audience rules see them. Member facts are resolved only
 * when a covering rule needs them (roles, Teams, Members); an `anyone` or
 * `identities` rule decides without a database read.
 */
export async function audienceSenderFor(input: {
  organizationId: string;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  message: InboundMessage;
  resolveChannelSender?: ChannelSenderResolver | undefined;
}): Promise<AudienceSender> {
  const identity = input.message.senderIdentity;
  if (
    input.resolveChannelSender === undefined ||
    !needsSenderFacts(input.route.audienceRules, input.message.conversation)
  ) {
    return { identity, member: null };
  }
  return {
    identity,
    member: await input.resolveChannelSender({
      organizationId: input.organizationId,
      account: input.account,
      senderIdentity: identity,
    }),
  };
}

/**
 * The one "may this sender use this route" decision, shared by the plane facade
 * and the bindings engine so neither can drift from the other.
 *
 * Ways in, in order: an audience rule whose Where covers the conversation
 * names the sender (docs/audits/2026-09-19-route-audience-rules.md); the
 * Advanced paths — the sender's roles grant `bot.interact`, or the route
 * authored an `access:` block and it admits them (this is what makes pairing
 * mean something — an operator-approved stranger has no Hub identity and no
 * role, and approval is the grant). A sender the access gate REFUSES never
 * gets here: `admitChannelAccess` settles the message first.
 */
export async function mayUseChannelRoute(input: {
  store?: ChannelAccessStore | undefined;
  organizationId: string;
  controlPlane: ChannelControlPlane;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  message: InboundMessage;
  resolveChannelSender?: ChannelSenderResolver | undefined;
  /** The message would start a conversation on this Route: a rule's
   * `contains` then decides whether it is a way in. */
  newConversation?: boolean | undefined;
}): Promise<ChannelRouteAdmission> {
  const { account, controlPlane, message, route } = input;
  const sender = await audienceSenderFor(input);
  const applicable =
    input.newConversation === true
      ? new Set(rulesFor(route, message.conversation, { text: message.text }))
      : undefined;
  const rules = admittingRules(route, message.conversation, sender).filter(
    (rule) => applicable === undefined || applicable.has(rule),
  );
  if (rules.length > 0) return { allowed: true, rules };
  if (mayTrigger(message.senderIdentity, controlPlane, account, route)) return { allowed: true };
  if (
    route.defaults.access !== undefined &&
    input.store !== undefined &&
    (await accessGateAllows({ ...input, store: input.store }))
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: "sender may not trigger this route" };
}

/**
 * The `access:` block's decision without its side effects: no pairing request
 * is minted and nothing is answered. A pairing challenge counts as a refusal —
 * the sender is not in yet. For the commands that only report access (`/me`,
 * `/status`), which must never change it.
 */
export async function accessGateAllows(input: {
  store: ChannelAccessStore;
  organizationId: string;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  message: InboundMessage;
}): Promise<boolean> {
  const access = input.route.defaults.access;
  if (access === undefined) return true;
  const storeAllowFrom = await input.store.listApprovedPairedSenders({
    organizationId: input.organizationId,
    channel: input.account.channel as SupportedChannelName,
    accountId: input.account.accountId,
  });
  return (
    evaluateChannelAccess({ access, message: input.message, storeAllowFrom }).decision === "allow"
  );
}

// Who is asking, for the commands that report access instead of using it:
// `/me` (about the sender) and `/status` (about this chat). Both answer anyone;
// each caller sees what their standing allows
// (docs/audits/2026-10-05-status-and-me-disclosure.md):
//   - anyone: their own channel id, this chat's ids, and whether they can talk here;
//   - admitted by the Route: the conditions they meet, and whether the bot is busy;
//   - admitted and linked to a Hub Member: the session and their access here;
//   - a Connection manager: which Route serves the chat and why a sender is refused.
// Resolving the caller never changes access: the gates run without minting a
// pairing request, recording activity or taking an execution slot.

import type { ChannelAccessStore } from "../db/channel-access.js";
import type { CompiledAudienceRule } from "./config/audience.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { EffectiveDefaults } from "./config/inheritance.js";
import { commandAccessRequest } from "./commands-context.js";
import { routeLabel } from "./commands-route-default.js";
import type { ChannelPlaneDeps, InboundMessage } from "./plane/types.js";
import { accessGateAllows, mayUseChannelRoute } from "./policy/gate.js";
import { senderTrigger } from "./rule-trigger.js";

export interface CommandCaller {
  /** The Route serving this chat admits the sender. */
  admitted: boolean;
  /** The Rules that admitted them; absent when admitted another way. */
  rules?: readonly CompiledAudienceRule[] | undefined;
  /** The Hub Member the sender's channel account is linked to. */
  member?: { name: string } | undefined;
  /** Holds `channel.manage` on this Connection. */
  manager: boolean;
  /** Why the sender is not admitted. Shown to a manager only. */
  refusal?: string | undefined;
}

export async function resolveCommandCaller(input: {
  plane: ChannelPlaneDeps;
  store: ChannelAccessStore | undefined;
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute | undefined;
}): Promise<CommandCaller> {
  // A failed lookup answers as the least-trusted caller, never as a member.
  const [standing, admission] = await Promise.all([
    memberStanding(input).catch(() => ({ manager: false })),
    routeAdmission(input).catch(() => ({
      admitted: false,
      refusal: "access could not be checked",
    })),
  ]);
  return { ...standing, ...admission };
}

async function memberStanding(input: {
  plane: ChannelPlaneDeps;
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute | undefined;
}): Promise<Pick<CommandCaller, "member" | "manager">> {
  const { plane } = input;
  const request = commandAccessRequest(
    plane,
    input.message,
    input.account,
    input.route,
    "channel.use",
  );
  const member = await plane.commandAccess?.resolveChannelMember(request);
  if (member === undefined) return { manager: false };
  const manager = await plane.commandAccess?.authorizeChannelAccountManagement?.(request);
  return { member: { name: member.name }, manager: manager !== undefined };
}

async function routeAdmission(input: {
  plane: ChannelPlaneDeps;
  store: ChannelAccessStore | undefined;
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute | undefined;
}): Promise<Pick<CommandCaller, "admitted" | "rules" | "refusal">> {
  const { plane, store, message, account, route } = input;
  if (route === undefined) return { admitted: false, refusal: "no Route serves this chat" };
  const scope = { organizationId: plane.organizationId, account, route, message };
  if (store !== undefined && !(await accessGateAllows({ ...scope, store }))) {
    return { admitted: false, refusal: "the Route's access list refuses this sender" };
  }
  const use = await mayUseChannelRoute({
    ...scope,
    store,
    controlPlane: plane.controlPlane,
    resolveChannelSender: plane.resolveChannelSender,
  });
  return use.allowed
    ? { admitted: true, rules: use.rules }
    : { admitted: false, refusal: "no Rule of the Route lets this sender in" };
}

/** Admitted and linked: the caller may see the session and their privileges. */
export function callerSeesSession(caller: CommandCaller): boolean {
  return caller.admitted && caller.member !== undefined;
}

/**
 * Whether a public command is answered at all. An admitted sender and a
 * manager always are. Anyone else gets silence when the Connection turned
 * `interaction.publicCommands` off, and at most one answer per window.
 */
export function answersPublicCommand(
  caller: CommandCaller,
  input: {
    account: Pick<CompiledChannelAccount, "channel" | "accountId"> & {
      defaults: Pick<EffectiveDefaults, "publicCommands">;
    };
    message: InboundMessage;
    command: string;
  },
  throttle: PublicCommandThrottle,
): boolean {
  if (caller.admitted || caller.manager) return true;
  const { account, message, command } = input;
  if (account.defaults.publicCommands === false) return false;
  return throttle.allow(
    [account.channel, account.accountId, message.senderIdentity, command].join("\0"),
  );
}

/**
 * One answer per sender and command per window, so a stranger cannot make the
 * bot talk faster — and still gets both `/status` and `/me`, the two ids an
 * admin needs.
 */
export class PublicCommandThrottle {
  private readonly answeredAt = new Map<string, number>();

  constructor(
    private readonly windowMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const last = this.answeredAt.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    if (this.answeredAt.size >= 10_000) this.prune(now);
    this.answeredAt.set(key, now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.answeredAt) {
      if (now - at >= this.windowMs) this.answeredAt.delete(key);
    }
  }
}

type AccessRequestPlane = Pick<
  ChannelPlaneDeps,
  "organizationId" | "resolveAgentAccessTarget" | "commandAccess"
>;
type AccessRequestAccount = Pick<CompiledChannelAccount, "connectionId" | "channel" | "accountId">;

/** `/me`: who the sender is, and — admitted and linked — their access here. */
export async function meText(input: {
  plane: AccessRequestPlane;
  message: InboundMessage;
  account: AccessRequestAccount;
  route: CompiledRoute | undefined;
  caller: CommandCaller;
}): Promise<string> {
  const { caller, message } = input;
  const lines = [
    senderIdLine(message),
    caller.member === undefined ? "Hub account: not linked" : `Hub account: ${caller.member.name}`,
    verdictLine(caller, "this chat's ID (/status)"),
    ...managerLines(caller),
  ];
  if (!callerSeesSession(caller)) return lines.join("\n");
  return [...lines, `Access here: ${(await privilegesHere(input)).join(", ") || "chat only"}`].join(
    "\n",
  );
}

async function privilegesHere(input: {
  plane: AccessRequestPlane;
  message: InboundMessage;
  account: AccessRequestAccount;
  route: CompiledRoute | undefined;
}): Promise<string[]> {
  const { plane } = input;
  const request = commandAccessRequest(
    plane,
    input.message,
    input.account,
    input.route,
    "agent.interact",
  );
  const privileges = ["agent.interact", "agent.create", "approval.config"] as const;
  const decisions = await Promise.all(
    privileges.map(async (privilege) =>
      (await plane.commandAccess?.authorizeChannelPrivilege({ ...request, privilege }))?.allowed
        ? privilege
        : undefined,
    ),
  );
  return decisions.filter((privilege) => privilege !== undefined);
}

/** `/status` before the session lines (`callerSeesSession`) or the busy line. */
export function callerChatLines(
  caller: CommandCaller,
  message: InboundMessage,
  served?: { route: CompiledRoute; account: CompiledChannelAccount },
): string[] {
  return [
    ...chatIdLines(message),
    verdictLine(caller, "your ID (/me)"),
    ...(caller.admitted && served !== undefined
      ? [conditionsLine(caller, message, served.route)]
      : []),
    ...(caller.manager && served !== undefined
      ? [`Route: ${routeLabel({ ...served, message })}`]
      : []),
    ...managerLines(caller),
  ];
}

/**
 * Where members already see each other's ids (Slack, Discord), the sender's id
 * is shown in a group too. Elsewhere it is shown in a DM only: a Telegram user
 * id is visible to bots, not to the people in the group.
 */
const IDS_VISIBLE_IN_GROUPS: ReadonlySet<string> = new Set(["slack", "discord"]);

function senderIdLine(message: InboundMessage): string {
  if (message.conversation.kind === "dm" || IDS_VISIBLE_IN_GROUPS.has(message.channel)) {
    return `Your ID: ${message.senderIdentity}`;
  }
  return "Your ID: not shown in a group here. Send /me to the bot in a direct message.";
}

function chatIdLines(message: InboundMessage): string[] {
  const { conversation, conversationLabel } = message;
  if (conversation.kind === "dm") {
    return ["This chat: a direct message. A Rule covers it with Where: Direct messages."];
  }
  const label = conversationLabel === undefined ? "" : ` (${conversationLabel})`;
  return [
    `Chat ID: ${conversation.rootConversationId}${label}`,
    ...(conversation.threadId === null
      ? []
      : [`${conversation.kind === "topic" ? "Topic" : "Thread"} ID: ${conversation.threadId}`]),
  ];
}

function verdictLine(caller: CommandCaller, other: string): string {
  if (caller.admitted) return "You can talk to the bot here.";
  return `You can't talk to the bot here. To ask for access, send your Hub admin this and ${other}.`;
}

function conditionsLine(
  caller: CommandCaller,
  message: InboundMessage,
  route: CompiledRoute,
): string {
  const { requireMention, followUp } = senderTrigger(route, message.conversation, caller.rules);
  if (!requireMention) return "Mention the bot: not needed.";
  return followUp.mode === "auto"
    ? `Mention the bot: needed, then not for ${followUp.ttlMinutes} minutes after its last reply.`
    : "Mention the bot: needed on every message.";
}

function managerLines(caller: CommandCaller): string[] {
  if (!caller.manager || caller.refusal === undefined) return [];
  return [`Why (shown to Connection managers): ${caller.refusal}.`];
}

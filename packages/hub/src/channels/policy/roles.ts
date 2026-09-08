// Channel actor roles: owner / admin / member / guest.
//
// This is a PROJECTION of the privilege model the Hub already decides with
// (`channels/policy.ts`), not a second RBAC. Upstream OpenClaw has no role
// vocabulary at all — it has an allowlist and a command-owner check
// (`src/pairing/command-owner.ts`) — so the names here are the Hub's, and each
// one is defined by evidence the Hub already holds:
//
//   owner   the principal who started this conversation's session (the binding's
//           initiator), or anyone whose effective roles grant everything.
//   admin   holds any `approval.*` privilege on this route: they can already
//           answer a tool-permission prompt, so they can also switch the
//           conversation's agent or model and stop someone else's turn.
//   member  a linked identity or an assignment covers them, and `bot.interact`
//           holds: they can chat, and control their OWN session.
//   guest   admitted only because the route opened its audience
//           (`audience: conversationParticipants`) or by the access allowlist,
//           with no Hub identity behind them. Chat only.
//
// The ordering is total, so a check is a comparison rather than a set of
// special cases.
import type { ChannelControlPlane, CompiledRoute } from "../config/compile.js";
import { privilegeHolds, routeRoleScope, isConfiguredChannelIdentity } from "../policy.js";

/** The four actor roles, least to most authority. */
export const CHANNEL_ACTOR_ROLES = ["guest", "member", "admin", "owner"] as const;
export type ChannelActorRole = (typeof CHANNEL_ACTOR_ROLES)[number];

/** The `approval.*` leaves; holding any one of them is what makes an admin. */
const APPROVAL_PRIVILEGES = [
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
] as const;

/**
 * The sender's role in one conversation on one route.
 *
 * `initiator` is the bound session's initiator when there is a session; pass
 * `undefined` before the first turn, when nobody owns the conversation yet.
 */
export function resolveChannelActorRole(input: {
  senderIdentity: string;
  controlPlane: ChannelControlPlane;
  route: CompiledRoute;
  initiator?: string | undefined;
}): ChannelActorRole {
  const scope = [routeRoleScope(input.route)];
  const holds = (privilege: string) =>
    privilegeHolds(input.senderIdentity, scope, input.controlPlane, privilege);
  if (input.initiator !== undefined && input.initiator === input.senderIdentity) return "owner";
  if (holds("*")) return "owner";
  if (APPROVAL_PRIVILEGES.some(holds)) return "admin";
  if (
    isConfiguredChannelIdentity(input.senderIdentity, input.route, input.controlPlane) &&
    holds("bot.interact")
  ) {
    return "member";
  }
  return "guest";
}

/** True when `role` is at least `required` in the ordering above. */
export function roleAtLeast(role: ChannelActorRole, required: ChannelActorRole): boolean {
  return CHANNEL_ACTOR_ROLES.indexOf(role) >= CHANNEL_ACTOR_ROLES.indexOf(required);
}

/**
 * The role each session command needs.
 *
 * `/help` and `/status` are reads. `/stop` and `/new` act on the conversation's
 * session, so the session's own owner may run them — anyone else needs admin,
 * which is what stops one member ending another's turn. `/agent` and `/model`
 * change what every later turn in the conversation runs on, so they are admin
 * regardless of who started it.
 */
export const CHANNEL_COMMAND_ROLE: Record<string, ChannelActorRole> = {
  help: "guest",
  status: "member",
  stop: "owner",
  new: "owner",
  agent: "admin",
  model: "admin",
};

/**
 * May this actor run this command? An `owner` requirement reads as "the
 * session's owner OR an admin", and that is one comparison rather than two
 * cases: `resolveChannelActorRole` already returns `owner` for the initiator,
 * and `owner` outranks `admin`.
 */
export function mayRunChannelCommand(command: string, role: ChannelActorRole): boolean {
  const required = CHANNEL_COMMAND_ROLE[command];
  if (required === undefined) return false;
  return roleAtLeast(role, required === "owner" ? "admin" : required);
}

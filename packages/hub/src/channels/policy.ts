// Runtime RBAC / approval policy engine for the channel control plane
// (implementation doc §4.3.2, §4.3.4, §4.3.6, §4.3.7; plan S6/S10). Pure
// decision logic over the compiled snapshot from `config/compile.ts` — no IO,
// no daemon calls. Effective privileges are recomputed on every message
// (§4.3.7), so a config edit is live from the next message, no reload.
//
// One decision path: channel identity → principal → effective roles (extends
// closures) → privilege check → decision.
//
// Inheritance note: the compiler already folds `defaultRoles` (policy <
// account < route, first-set layer wins) into `account.defaultRoles`,
// `route.defaultRoles`, and `fallback.defaultRoles`, and concatenates the
// org ⊕ account ⊕ route `assignments` into `CompiledRoute.assignments`. This
// engine reads those resolved values — it does not re-derive inheritance.

import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledFallback,
  CompiledRoute,
  RouteTarget,
} from "./config/compile.js";
import type { RoleAssignment } from "./config/schema.js";
import { privilegeCovers, roleGrants, type CompiledRole } from "./config/privileges.js";
import { PRIVILEGE_LEAVES } from "./config/enums.js";
import type { AgentPermissionRequest } from "./daemon/types.js";

// --- Tool classes ---------------------------------------------------------------
//
// `AgentPermissionRequest` carries provider-native tool names (claude
// `Bash`/`Edit`/`Write`, codex `CodexBash`/`CodexFileChange`, opencode/omp
// `bash`/`edit`/`write`) plus `input.command` for shell tools. The tool class
// is the unit both the approval rules (`match:`) and the approver privileges
// (`approval.<class>`) talk about, so one request maps to exactly one class.
//
// Mapping table (request name / input → class):
//   file:                  claude Edit | Write | MultiEdit | NotebookEdit |
//                          TodoWrite; codex CodexFileChange; opencode/omp
//                          edit | write
//   config:                claude Config | ConfigEdit | ConfigDelete
//   command.destructive:   a command request whose `input.command` runs a
//                          known destructive form (DESTRUCTIVE_COMMAND_PATTERNS)
//   command:               any other shell/command tool (claude Bash; codex
//                          CodexBash; opencode/omp bash)
//   channel:               tool names in the `channel.tool.<name>` P1 namespace
//   other:                 everything else — no `approval.other` privilege
//                          exists in the closed catalog, so only a `*`-granting
//                          role can approve it (fail-closed by construction)

// The classifier's output vocabulary — the five authorable tool classes plus
// `other` (a catch-all that is NOT authorable: it has no `approval.other`
// privilege leaf, so only a `*`-granting role can approve it). `config/enums.ts`
// keeps the authorable subset under its own name; this is the superset the
// mapper emits.
export const CLASSIFIED_TOOL_CLASSES = [
  "file",
  "config",
  "command",
  "command.destructive",
  "channel",
  "other",
] as const;
export type ClassifiedToolClass = (typeof CLASSIFIED_TOOL_CLASSES)[number];

/**
 * Destructive-command heuristic: an explicit, boring list — no general parser.
 * A shell request maps to `command.destructive` when `input.command` matches
 * any of these (case-insensitive); everything else stays `command`. Routes may
 * only override through their approval rules, never through this table.
 */
const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  // `rm` with both a recursive and a force flag, in any order / spelling
  // (-rf / -fr / -Rf / -r -f / -f -r). A bare `-f` or `-R` stays `command`.
  // Four boring shapes instead of one clever parser: combined token
  // (r-then-f / f-then-r) or two flag tokens (r-then-f / f-then-r).
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rR][a-z]*f[a-z]*\s+/iu, // -rf / -Rf
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*f[a-z]*[rR][a-z]*\s+/iu, // -fr / -fR
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rR][a-z]*\s+(?:-[a-z]+\s+)*-[a-z]*f[a-z]*\s+/iu, // -r -f
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*f[a-z]*\s+(?:-[a-z]+\s+)*-[a-z]*[rR][a-z]*\s+/iu, // -f -r
  /\bfind\b[^\n|;&]*\s-delete\b/iu, // find … -delete
  /\bmkfs(\.\w+)?\b/iu, // mkfs / mkfs.ext4 / …
  /\bshred\s+/iu, // shred
  /\bdd\b[^\n|;&]*\bof=/iu, // dd of=/dev/…
  /\b(shutdown|reboot|halt|poweroff)\b/iu,
  /(^|[\s;|])>(\s*)\/(dev\/)?(sd|nvme|hd|xvd)\b/iu, // > /dev/sda …
  /\b(DROP|DELETE|TRUNCATE)\s+(TABLE|DATABASE|INDEX)\b/iu, // SQL DDL/DML
  /\bgit\s+push\b[^\n|;&]*--force\b/iu, // git push --force (any arg order)
  /\bgit\s+push\b[^\n|;&]*\s-f(\s|$)/iu, // git push -f
  /\bgit\s+push\s+--mirror\b/iu,
  /\bgit\s+reset\s+--hard\b/iu,
  /\bgit\s+clean\b[^\n|;&]*-[a-z]*f/iu, // git clean -f / -df
  /\bchmod\s+(-[a-z]+\s+)*[0-7]*777/iu, // chmod 777 / chmod -R 777
  /\bchown\s+(-[a-z]+\s+)*-R/iu, // chown -R
  /\bcrontab\s+-r\b/iu,
  /\bkillall\b/iu,
  /\bpkill\s+(-[a-z]+\s+)*(-9|SIGKILL)\b/iu,
  /\bsystemctl\s+(stop|disable|mask)\b/iu,
  /\bservice\s+\S+\s+stop\b/iu,
];

/** Shell/command tool names whose `input.command` decides the class. */
const COMMAND_TOOL_NAMES = new Set(["bash", "shell", "terminal", "exec", "execute_command"]);

/** File-touching tool names by provider (see the mapping table above). */
const FILE_TOOL_NAMES = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "todowrite",
  "codexfilechange",
]);

/** Config-mutation tool names (claude). */
const CONFIG_TOOL_NAMES = new Set(["config", "configedit", "configdelete"]);

/** Map a permission request to its tool class (boring table + destructive list). */
export function classifyToolClass(request: AgentPermissionRequest): ClassifiedToolClass {
  const name = request.name.toLowerCase();
  if (name.startsWith("channel.tool.")) return "channel";
  if (FILE_TOOL_NAMES.has(name)) return "file";
  if (CONFIG_TOOL_NAMES.has(name)) return "config";
  const command = commandOf(request);
  if (name === "codexbash" || COMMAND_TOOL_NAMES.has(name)) {
    return command !== null && isDestructiveCommand(command) ? "command.destructive" : "command";
  }
  if (command !== null && isDestructiveCommand(command)) return "command.destructive";
  return "other";
}

/** First string of `input.command` / `input.cmd` / `input.script`; null otherwise. */
function commandOf(request: AgentPermissionRequest): string | null {
  for (const key of ["command", "cmd", "script"] as const) {
    const value = request.input?.[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

// --- Principals -------------------------------------------------------------------
//
// A channel identity (`<channel>:<provider-id>`) resolves to its user when
// `identityOwners` maps it; otherwise it is its own (anonymous) principal.
// Assignment values are `user:<username>` (all of that user's identities) or a
// raw identity (a mapped one resolves to its user, so both forms grant the
// same principal) (§4.3.2).

/** Resolve a channel identity to the principal it stands for. */
export function resolvePrincipal(identity: string, controlPlane: ChannelControlPlane): string {
  return controlPlane.identityOwners[identity] ?? identity;
}

/** One resolved role source at a decision level (org, account, or route). */
export interface RoleScope {
  /** The collapsed `defaultRoles` at this level (policy < account < route). */
  defaultRoles: readonly string[];
  /** The role assignments that apply at this level. */
  assignments: readonly RoleAssignment[];
}

/** True when an assignment's identities cover the (resolved) principal. */
export function assignmentCoversPrincipal(
  assignment: RoleAssignment,
  principal: string,
  identityOwners: Readonly<Record<string, string>>,
): boolean {
  for (const value of assignment.identities) {
    if (value === `user:${principal}`) return true;
    const owner = identityOwners[value];
    if (owner !== undefined && owner === principal) return true;
    if (owner === undefined && value === principal) return true;
  }
  return false;
}

/**
 * Effective roles for a principal across the given scopes: the union of roles
 * from every assignment that covers the principal, plus every scope's
 * `defaultRoles` (additive). Unknown role names contribute nothing
 * (fail-closed: silent skip, not an error) — only names present in `roles`
 * reach the result. `principal` must already be resolved via
 * `resolvePrincipal`.
 */
export function effectiveRoles(
  principal: string,
  scopes: readonly RoleScope[],
  controlPlane: ChannelControlPlane,
): readonly string[] {
  const owners = controlPlane.identityOwners;
  const names = new Set<string>();
  for (const scope of scopes) {
    for (const assignment of scope.assignments) {
      if (!assignmentCoversPrincipal(assignment, principal, owners)) continue;
      for (const role of assignment.roles) {
        if (controlPlane.roles[role] !== undefined) names.add(role);
      }
    }
    for (const role of scope.defaultRoles) {
      if (controlPlane.roles[role] !== undefined) names.add(role);
    }
  }
  return [...names];
}

/** The role set an effective role list expands to, `extends` closures included. */
function closedRoleSet(
  roleNames: readonly string[],
  controlPlane: ChannelControlPlane,
): CompiledRole[] {
  const names = new Set<string>();
  for (const name of roleNames) {
    const role = controlPlane.roles[name];
    if (role === undefined) continue;
    for (const closed of role.closure) names.add(closed);
  }
  const roles: CompiledRole[] = [];
  for (const name of names) {
    const role = controlPlane.roles[name];
    if (role !== undefined) roles.push(role);
  }
  return roles;
}

/**
 * The single privilege check: `privilege` holds for the channel identity
 * (resolved to its principal) when any role in the effective roles' closures
 * grants it and that role's own deny does not (`roleGrants` per-role
 * semantics; denies never reach across `extends`, §4.3.7).
 */
export function privilegeHolds(
  identity: string,
  scopes: readonly RoleScope[],
  controlPlane: ChannelControlPlane,
  privilege: string,
): boolean {
  const principal = resolvePrincipal(identity, controlPlane);
  const closed = closedRoleSet(effectiveRoles(principal, scopes, controlPlane), controlPlane);
  return closed.some((role) => roleGrants(role, privilege));
}

/**
 * The closed privilege catalog the policy engine decides over (§4.3.7) —
 * re-exported from `config/enums.js` so the catalog has one home.
 */
export const PRIVILEGE_CATALOG = PRIVILEGE_LEAVES;

/**
 * Effective privileges for a channel identity at a scope: the catalog leaves
 * that hold over the effective roles' closures.
 */
export function effectivePrivileges(
  identity: string,
  scopes: readonly RoleScope[],
  controlPlane: ChannelControlPlane,
): readonly string[] {
  return PRIVILEGE_CATALOG.filter((privilege) =>
    privilegeHolds(identity, scopes, controlPlane, privilege),
  );
}

// --- Kill switches -------------------------------------------------------------------
//
// §4.3.7: "Kill switches: four levels, any one of which stops the rest —
// global env flag > org-level `channels/policy.yml` `enabled: false` >
// per-channel `channels.<channel>.enabled: false` > per-account `enabled:
// false`." The env flag (process-level, needs a restart) is applied by the
// caller; this check composes it with the three config levels.

/** The control plane is on when every kill-switch level is on. */
export function isEnabled(
  envFlag: boolean,
  controlPlane: ChannelControlPlane,
  account: CompiledChannelAccount,
): boolean {
  return envFlag && controlPlane.enabled && account.channelEnabled && account.enabled;
}

// --- Routing ---------------------------------------------------------------------------

/** An inbound conversation descriptor for route matching. */
export interface InboundConversation {
  /** The conversation's native kind, in the route match vocabulary. */
  kind: "dm" | "channel" | "thread" | "group" | "topic";
  /** The native conversation id (provider id, string). */
  id: string;
}

/** The outcome of matching an inbound conversation against an account. */
export interface RouteMatchResult {
  /** The first matching route, or null when the fallback applies. */
  route: CompiledRoute | null;
  /** The account fallback (deny marker or catch-all route). */
  fallback: CompiledFallback;
  /** The target to drive — the matched route's, or the catch-all's. */
  target: RouteTarget | null;
}

/** Does the structural part of a route match this conversation? */
export function routeConversationMatches(
  match: CompiledRoute["match"],
  conversation: InboundConversation,
): boolean {
  if (match.kind !== conversation.kind) return false;
  return match.ids.length === 0 || match.ids.includes(conversation.id);
}

/** Does a route match this conversation and normalized inbound text? */
export function routeMatches(
  match: CompiledRoute["match"],
  conversation: InboundConversation,
  text?: string,
): boolean {
  if (!routeConversationMatches(match, conversation)) return false;
  return match.contains === undefined || (text !== undefined && text.includes(match.contains));
}

/**
 * Routes in declaration order, first match wins (empty `ids` = kind-level
 * match, so a `kind: dm` route matches any DM). No route matched → the
 * fallback: the deny marker, or the catch-all route when `fallback.deny` is
 * false (§4.3.6).
 */
export function matchRoute(
  conversation: InboundConversation,
  account: CompiledChannelAccount,
  text?: string,
): RouteMatchResult {
  const route =
    account.routes.find((candidate) => routeMatches(candidate.match, conversation, text)) ?? null;
  if (route !== null) return { route, fallback: account.fallback, target: route.target };
  const fallback = account.fallback;
  return {
    route: null,
    fallback,
    target: fallback.deny ? null : (fallback.target ?? null),
  };
}

// --- Role scopes per decision level ---------------------------------------------------
//
// Each builder returns the COMPLETE resolved scope for that level: the
// compiler has already folded `defaultRoles` (policy < account < route) and
// concatenated the org ⊕ account ⊕ route assignments, so the scope carries
// everything a decision at that level needs. Pass the single scope for the
// level being decided (a matched route, or the account fallback).

/** The complete role scope for a matched route (org ⊕ account ⊕ route). */
export function routeRoleScope(route: CompiledRoute): RoleScope {
  return { defaultRoles: route.defaultRoles, assignments: route.assignments };
}

/** The complete role scope for the account fallback (org ⊕ account ⊕ fallback). */
export function fallbackRoleScope(
  controlPlane: ChannelControlPlane,
  account: CompiledChannelAccount,
): RoleScope {
  const fallback = account.fallback;
  return {
    defaultRoles: fallback.defaultRoles ?? [],
    assignments: [
      ...controlPlane.assignments,
      ...account.assignments,
      ...(fallback.assignments ?? []),
    ],
  };
}

/** The complete role scope at the account level (org ⊕ account). */
export function accountRoleScope(
  controlPlane: ChannelControlPlane,
  account: CompiledChannelAccount,
): RoleScope {
  return {
    defaultRoles: account.defaultRoles,
    assignments: [...controlPlane.assignments, ...account.assignments],
  };
}

// --- Decisions ---------------------------------------------------------------------------

/**
 * RBAC gate on inbound channel messages: the sender's channel identity may
 * start/take part in a conversation on this route when its effective
 * privileges include `bot.interact` (§4.3.7: "Trigger requires effective
 * `bot.interact`"). Kill switches are composed separately via `isEnabled` —
 * when one is off the transport does not exist, so the gate is moot.
 */
export function mayTrigger(
  senderIdentity: string,
  controlPlane: ChannelControlPlane,
  account: CompiledChannelAccount,
  route: CompiledRoute,
): boolean {
  if (!isConfiguredChannelIdentity(senderIdentity, route, controlPlane)) return false;
  return privilegeHolds(senderIdentity, [routeRoleScope(route)], controlPlane, "bot.interact");
}

/** Explicit open audience is bounded to named Conversations and requires a mention outside DMs. */
export function externalParticipantMayTrigger(
  message: Pick<import("./plane/types.js").InboundMessage, "mentionedBot" | "conversation">,
  route: CompiledRoute,
): boolean {
  if (route.audience?.kind !== "conversationParticipants") return false;
  if (route.match.ids.length === 0) return false;
  if (message.conversation.kind === "dm") return true;
  return message.mentionedBot;
}

/** Legacy Channel identities count as Members only when explicitly mapped or assigned. */
export function isConfiguredChannelIdentity(
  identity: string,
  route: CompiledRoute,
  controlPlane: ChannelControlPlane,
): boolean {
  if (controlPlane.identityOwners[identity] !== undefined) return true;
  return route.assignments.some(({ identities }) => identities.includes(identity));
}

/** An approval decision for one `permission_requested` event. */
export type ApprovalDecision =
  | { mode: "auto-allow" }
  | { mode: "auto-deny" }
  | { mode: "prompt"; initiatorOnly: boolean };

/**
 * Does a rule's `match` cover this tool class? The match is a tool class
 * (`command.destructive`, `file`), a privilege reference (`approval.command`,
 * `approval.*`), or `*` — normalized to privilege form and checked with the
 * same `privilegeCovers` dot-nesting + wildcard semantics as the privilege
 * algebra (§4.3.6: "tool class / privilege + `*` wildcards").
 */
export function ruleMatchCoversToolClass(
  ruleMatch: string,
  toolClass: ClassifiedToolClass,
): boolean {
  const pattern = ruleMatch.startsWith("approval.") ? ruleMatch : `approval.${ruleMatch}`;
  return privilegeCovers(pattern, `approval.${toolClass}`);
}

/**
 * First-match decision from the route's merged approval list (route prepended,
 * then account, then org defaults — most-specific-first, §4.3.2). No matching
 * rule defaults to `prompt` (fail-closed: an unmatched class is never
 * auto-allowed).
 */
export function approvalDecisionFor(
  toolClass: ClassifiedToolClass,
  route: CompiledRoute,
): ApprovalDecision {
  for (const rule of route.approval) {
    if (!ruleMatchCoversToolClass(rule.match, toolClass)) continue;
    if (rule.mode === "require") {
      return { mode: "prompt", initiatorOnly: rule.initiatorOnly ?? false };
    }
    return rule.mode === "auto-allow" ? { mode: "auto-allow" } : { mode: "auto-deny" };
  }
  return { mode: "prompt", initiatorOnly: false };
}

/** A re-authorization outcome for a responder's answer to a prompted approval. */
export interface ApproverCheck {
  allowed: boolean;
  /** Why the answer was refused (or "ok"); "auto-allowed" when no human answers. */
  reason:
    | "auto-allowed"
    | "auto-denied"
    | "not-initiator"
    | "class-not-approved"
    | "prompt-not-open"
    | "ok";
}

/**
 * Re-authorization of a responder's answer to a prompted approval — the
 * second authority check (plan S6: "two independent authority checks:
 * inbound entry + approval exit"). The responder's channel identity may answer
 * when its effective privileges include `approval.<class>` AND the route's
 * merged rule list does not auto-deny the class; `initiatorOnly`, when set,
 * additionally requires the responder to be the thread's initiator (plan S10:
 * the session stays `approval-required` — routes relax per tool class, never
 * the posture). When the merged rule auto-allows the class there is no
 * prompt, so no responder is consulted (reported as "auto-allowed").
 */
export function mayApprove(
  responderIdentity: string,
  toolClass: ClassifiedToolClass,
  initiatorIdentity: string,
  controlPlane: ChannelControlPlane,
  account: CompiledChannelAccount,
  route: CompiledRoute,
): ApproverCheck {
  const decision = approvalDecisionFor(toolClass, route);
  if (decision.mode === "auto-allow") return { allowed: true, reason: "auto-allowed" };
  if (decision.mode === "auto-deny") return { allowed: false, reason: "auto-denied" };
  if (
    decision.mode === "prompt" &&
    decision.initiatorOnly &&
    responderIdentity !== initiatorIdentity
  ) {
    return { allowed: false, reason: "not-initiator" };
  }
  if (
    !privilegeHolds(
      responderIdentity,
      [routeRoleScope(route)],
      controlPlane,
      `approval.${toolClass}`,
    )
  ) {
    return { allowed: false, reason: "class-not-approved" };
  }
  return { allowed: true, reason: "ok" };
}

// --- The approval-required posture (invariant: plan S10 / §4.3.7) ---------------------------
//
// "channel-originated sessions are `approval-required` (plan S10) — routes may
// relax per tool, never lift the posture." The posture is not a configurable
// value; it is the invariant every approval path obeys: an `auto-allow` rule
// relaxes one tool class (and only via its explicit match), `mayApprove` stays
// the single gate for everything else, and the check below makes the invariant
// testable at the composition point.

/** The channel session trust posture — a hard invariant, not a config value. */
export const CHANNEL_SESSION_POSTURE = "approval-required" as const;

/**
 * True when the route's merged rules do NOT auto-allow every tool class —
 * i.e. the approval-required posture still holds for at least one class.
 */
export function postureIsApprovalRequired(route: CompiledRoute): boolean {
  return CLASSIFIED_TOOL_CLASSES.some(
    (toolClass) => approvalDecisionFor(toolClass, route).mode !== "auto-allow",
  );
}

/**
 * Thrown when a route's merged approval rules auto-allow every tool class —
 * i.e. they lift the S10 `approval-required` posture. Named so composition
 * points can catch the invariant violation distinctly from a generic policy
 * error.
 */
export class ApprovalPostureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalPostureError";
  }
}

/**
 * Asserts the S10 invariant for a route: no rule set may auto-allow every
 * tool class. Routes may relax per tool class, never the posture itself.
 */
export function assertApprovalRequiredPosture(route: CompiledRoute): void {
  if (postureIsApprovalRequired(route)) return;
  throw new ApprovalPostureError(
    "route lifts the approval-required posture: every tool class is auto-allowed; " +
      "relax per tool class, never the posture (plan S10)",
  );
}

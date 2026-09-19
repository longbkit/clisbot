import type { AccessResourceKind, SubjectKind } from "./access-catalog";
import { CAN_SHARE_PRIVILEGE } from "./access-grantor";

/**
 * Plain-language effects of an access grant. Every surface that explains a grant —
 * the level picker, the summary under it, the confirmation, and assignment rows —
 * reads these, so the wording cannot drift between them. Summaries are computed
 * from the privileges a grant holds, not from a level name, so a custom grant is
 * described as truthfully as a built-in one.
 */
export interface AccessSummary {
  allows: string[];
  withholds: string[];
  cautions: string[];
}

const APPROVALS = [
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.other",
] as const;

/** Unattended execution is gated on holding every approval leaf the daemon checks. */
const EVERY_APPROVAL = [...APPROVALS, "approval.channel"] as const;

const LEVEL_DESCRIPTIONS: Record<string, string | ((kind: AccessResourceKind) => string)> = {
  connect: "Connect to the Host. Grants no Project on its own.",
  office_worker: "Use agents in existing workspaces. No terminal, no shell commands.",
  developer: "Terminal, worktrees, and every approval. Cannot create or manage Projects.",
  full_access: (kind) =>
    kind === "daemon"
      ? "Developer, plus create Projects in any folder and manage every Project on this Host."
      : "Developer, plus rename, remove, and archive this Project and its workspaces.",
  administrator: "Operate this Host with any model. Always can share.",
  use: "Talk to the bot in the chosen conversations.",
  manage:
    "Edit this Channel Route's audience rules and defaults, on the app and in chat, and appoint another Admin. Who may talk to the bot is set on the Route.",
  run: "Run this Automation.",
  admin: (kind) =>
    kind === "team"
      ? "Add or remove people in this Team, invite into it, appoint another Team Admin."
      : "Run, edit, enable, or delete this Automation, and grant Run or Admin on it.",
};

/**
 * Can share on a Host or Project: the same `hub.access.manage` privilege that is
 * Admin on a Team or Automation. Full access and Administrator always carry it;
 * Office worker and Developer carry it only when the grant names it.
 */
export function sharesAccess(resourceKind: AccessResourceKind, privileges: readonly string[]) {
  return (
    (resourceKind === "daemon" || resourceKind === "project") &&
    privileges.includes(CAN_SHARE_PRIVILEGE)
  );
}

export function canShareDescription(resourceKind: AccessResourceKind): string {
  const scope = resourceKind === "daemon" ? "Host" : "Project";
  return `Add, change, or remove people on this ${scope}, up to their own level`;
}

/** One line for a level in the picker, or undefined for a level with no description. */
export function accessLevelDescription(
  levelId: string,
  resourceKind: AccessResourceKind,
): string | undefined {
  const description = LEVEL_DESCRIPTIONS[levelId];
  return typeof description === "function" ? description(resourceKind) : description;
}

/** The effects a grant of these privileges on this kind of resource has. */
export function summarizeAccess(input: {
  privileges: readonly string[];
  resourceKind: AccessResourceKind;
  subjectKind?: SubjectKind | undefined;
}): AccessSummary {
  const held = new Set(input.privileges);
  const summary: AccessSummary = { allows: [], withholds: [], cautions: [] };
  if (input.subjectKind === "guest") {
    summary.cautions.push("Guest is every channel sender without a linked Member, not one person");
  }
  if (input.resourceKind === "team") {
    summarizeTeamAdmin(held, summary);
    return summary;
  }
  if (input.resourceKind === "channel_account" || input.resourceKind === "automation") {
    summarizeRoutes(held, summary);
    return summary;
  }
  if (held.has("daemon.manage")) {
    summary.allows.push("Operate this Host: restart, update, settings, providers, and plugins");
    summary.allows.push("Every Project, workspace, agent, and terminal on this Host");
    summary.allows.push(canShareDescription(input.resourceKind));
    summary.cautions.push(
      "Not limited to the allowed models, and can change who reaches this Host",
    );
    return summary;
  }
  summarizeProjectWork(held, input.resourceKind, summary);
  if (held.has(CAN_SHARE_PRIVILEGE)) summary.allows.push(canShareDescription(input.resourceKind));
  return summary;
}

function summarizeTeamAdmin(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (!held.has(CAN_SHARE_PRIVILEGE)) return;
  summary.allows.push("Add or remove people in this Team and invite Members into it");
  summary.allows.push("Appoint another Team Admin");
  summary.withholds.push("Cannot change the Team's access grants or delete the Team");
}

function summarizeRoutes(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (held.has("channel.manage")) {
    summary.allows.push("Edit this Channel Route's audience rules, Routes, and defaults");
    summary.allows.push("Relink the account and read its activity");
    if (held.has(CAN_SHARE_PRIVILEGE)) summary.allows.push("Appoint another Admin on this Route");
    summary.withholds.push("Who may talk to the bot is set in the Route's audience rules");
    summary.withholds.push("The bot token stays with Organization Admins");
  }
  if (held.has("automation.run")) summary.allows.push("Run this Automation");
  if (held.has("automation.run") && held.has(CAN_SHARE_PRIVILEGE)) {
    summary.allows.push("Edit, enable, or delete this Automation, and grant Run or Admin on it");
  }
}

function summarizeProjectWork(
  held: ReadonlySet<string>,
  resourceKind: AccessResourceKind,
  summary: AccessSummary,
): void {
  const onHost = resourceKind === "daemon";
  if (held.has("project.use")) {
    summary.allows.push(
      onHost
        ? "Use every Project on this Host, including Projects added later"
        : "Use this Project and its workspaces",
    );
    if (onHost)
      summary.cautions.push("A Project assignment can add to this grant, never narrow it");
  } else if (held.has("daemon.connect")) {
    summary.allows.push("Connect to this Host");
    summary.withholds.push("No Project until one is granted");
    return;
  }
  allowIf(held, "agent.interact", "Chat with agents and switch their model", summary);
  allowIf(held, "agent.create", "Start agent sessions with the allowed models", summary);
  allowIf(held, "agent.fast.use", "Use Fast mode, which may cost more", summary);
  allowIf(held, "workspace.create", "Create workspaces and worktrees", summary);
  allowIf(held, "terminal.use", "Open terminals", summary);
  if (!held.has("terminal.use")) summary.withholds.push("No terminal");
  summarizeApprovals(held, summary);
  summarizeManagement(held, onHost, summary);
  if (held.has("terminal.use") || held.has("approval.command")) {
    summary.cautions.push(
      "Terminals and approved commands run as the Host's account, beyond Project and model limits",
    );
  }
}

function summarizeApprovals(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (EVERY_APPROVAL.every((privilege) => held.has(privilege))) {
    summary.allows.push("Approve every action, destructive commands included");
    summary.allows.push("Run agents without asking for approval");
    return;
  }
  allowIf(held, "approval.file", "Approve file edits", summary);
  allowIf(held, "approval.config", "Approve configuration changes", summary);
  allowIf(held, "approval.command", "Approve shell commands", summary);
  allowIf(held, "approval.command.destructive", "Approve destructive commands", summary);
  allowIf(held, "approval.other", "Approve other tools, such as web fetch and MCP tools", summary);
  if (!held.has("approval.command")) summary.withholds.push("Cannot approve shell commands");
}

function summarizeManagement(
  held: ReadonlySet<string>,
  onHost: boolean,
  summary: AccessSummary,
): void {
  if (!held.has("workspace.manage")) {
    if (!held.has("workspace.create")) {
      summary.withholds.push("Cannot create workspaces or worktrees");
    }
    summary.withholds.push("Cannot create, rename, or remove Projects");
    return;
  }
  summary.allows.push(
    onHost
      ? "Create Projects in any folder on this Host"
      : "Create Projects inside this Project's folder",
  );
  summary.allows.push(
    onHost
      ? "Rename, remove, or archive any Project, workspace, or worktree on this Host"
      : "Rename, remove, or archive this Project and its workspaces and worktrees",
  );
  summary.cautions.push(
    "Removing a Project stops every agent in it, including other people's; cleaning a worktree can delete it from disk",
  );
  if (onHost) summary.cautions.push("Any folder this machine can read can become a Project");
}

function allowIf(
  held: ReadonlySet<string>,
  privilege: string,
  effect: string,
  summary: AccessSummary,
): void {
  if (held.has(privilege)) summary.allows.push(effect);
}

/**
 * What saving would change, in the same words as the summary. Empty lists mean the
 * saved grant and the new one have the same effect.
 */
export function accessChanges(input: {
  before: readonly string[];
  after: readonly string[];
  resourceKind: AccessResourceKind;
}): { added: string[]; removed: string[] } {
  const before = summarizeAccess({ privileges: input.before, resourceKind: input.resourceKind });
  const after = summarizeAccess({ privileges: input.after, resourceKind: input.resourceKind });
  return {
    added: after.allows.filter((effect) => !before.allows.includes(effect)),
    removed: before.allows.filter((effect) => !after.allows.includes(effect)),
  };
}

/**
 * The built-in level whose privileges this grant holds exactly, ignoring what
 * the form adds on top of any level: Fast mode, and Can share on a Host or
 * Project. Undefined for a custom grant.
 */
export function matchingAccessLevel(
  accessLevels: Record<string, Record<string, readonly string[]>>,
  resourceKind: AccessResourceKind,
  privileges: readonly string[],
): string | undefined {
  const held = new Set(levelPrivileges(resourceKind, privileges));
  for (const [levelId, candidate] of Object.entries(accessLevels[resourceKind] ?? {})) {
    const expected = new Set(levelPrivileges(resourceKind, candidate));
    if (expected.size === held.size && [...expected].every((p) => held.has(p))) return levelId;
  }
  return undefined;
}

/** The privileges that decide a level, with the flags the form adds on top removed. */
function levelPrivileges(resourceKind: AccessResourceKind, privileges: readonly string[]) {
  const flags =
    resourceKind === "daemon" || resourceKind === "project"
      ? ["agent.fast.use", CAN_SHARE_PRIVILEGE]
      : ["agent.fast.use"];
  return privileges.filter((privilege) => !flags.includes(privilege));
}

/** Effects as a bulleted text block under an optional heading, or null when there are none. */
export function effectLines(title: string | null, effects: readonly string[]): string | null {
  if (effects.length === 0) return null;
  const bullets = effects.map((effect) => `• ${effect}`);
  return (title === null ? bullets : [`${title}:`, ...bullets]).join("\n");
}

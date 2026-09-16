import type { AccessResourceKind, SubjectKind } from "./access-catalog";

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
  administrator: "Operate this Host with any model, including its access settings.",
  use: "Talk to the bot in the chosen conversations.",
  manage: "Use, plus change this Channel Route's defaults. Needs All conversations.",
  run: "Run this Automation.",
};

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
  if (input.resourceKind === "channel_account" || input.resourceKind === "automation") {
    summarizeRoutes(held, summary);
    return summary;
  }
  if (held.has("daemon.manage")) {
    summary.allows.push("Operate this Host: restart, update, settings, providers, and plugins");
    summary.allows.push("Every Project, workspace, agent, and terminal on this Host");
    summary.cautions.push(
      "Not limited to the allowed models, and can change who reaches this Host",
    );
    return summary;
  }
  summarizeProjectWork(held, input.resourceKind, summary);
  return summary;
}

function summarizeRoutes(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (held.has("channel.use")) summary.allows.push("Talk to the bot in the chosen conversations");
  if (held.has("channel.manage")) {
    summary.allows.push("Change this Channel Route's defaults from a conversation");
  }
  if (held.has("automation.run")) summary.allows.push("Run this Automation");
  if (held.has("channel.use")) {
    summary.withholds.push("Controlling an agent still needs access to its Project");
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
 * The built-in level whose privileges this grant holds exactly, ignoring Fast mode,
 * which the form adds on top of any level. Undefined for a custom grant.
 */
export function matchingAccessLevel(
  accessLevels: Record<string, Record<string, readonly string[]>>,
  resourceKind: AccessResourceKind,
  privileges: readonly string[],
): string | undefined {
  const held = new Set(privileges.filter((privilege) => privilege !== "agent.fast.use"));
  for (const [levelId, levelPrivileges] of Object.entries(accessLevels[resourceKind] ?? {})) {
    if (levelPrivileges.length === held.size && levelPrivileges.every((p) => held.has(p))) {
      return levelId;
    }
  }
  return undefined;
}

/** Effects as a bulleted text block under an optional heading, or null when there are none. */
export function effectLines(title: string | null, effects: readonly string[]): string | null {
  if (effects.length === 0) return null;
  const bullets = effects.map((effect) => `• ${effect}`);
  return (title === null ? bullets : [`${title}:`, ...bullets]).join("\n");
}

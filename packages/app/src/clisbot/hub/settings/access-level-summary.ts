import { i18n } from "@/i18n/i18next";
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

// Resolved when read, so a language change reaches the next render.
const LEVEL_DESCRIPTIONS: Record<string, (kind: AccessResourceKind) => string> = {
  connect: () => i18n.t("hub.access.levelDescriptions.connect"),
  office_worker: () => i18n.t("hub.access.levelDescriptions.officeWorker"),
  developer: () => i18n.t("hub.access.levelDescriptions.developer"),
  full_access: (kind) =>
    kind === "daemon"
      ? i18n.t("hub.access.levelDescriptions.fullAccessHost")
      : i18n.t("hub.access.levelDescriptions.fullAccessProject"),
  administrator: () => i18n.t("hub.access.levelDescriptions.administrator"),
  use: () => i18n.t("hub.access.levelDescriptions.use"),
  manage: () => i18n.t("hub.access.levelDescriptions.manage"),
  run: () => i18n.t("hub.access.levelDescriptions.run"),
  admin: (kind) =>
    kind === "team"
      ? i18n.t("hub.access.levelDescriptions.adminTeam")
      : i18n.t("hub.access.levelDescriptions.adminAutomation"),
};

/**
 * Can share on a Host or Project: the same `hub.access.manage` privilege that is
 * Admin on a Team or Automation. Administrator always carries it; every other
 * level only when the grant names it, which Full access does by default.
 */
export function sharesAccess(resourceKind: AccessResourceKind, privileges: readonly string[]) {
  return (
    (resourceKind === "daemon" || resourceKind === "project") &&
    privileges.includes(CAN_SHARE_PRIVILEGE)
  );
}

export function canShareDescription(resourceKind: AccessResourceKind): string {
  return resourceKind === "daemon"
    ? i18n.t("hub.access.canShare.host")
    : i18n.t("hub.access.canShare.project");
}

/** One line for a level in the picker, or undefined for a level with no description. */
export function accessLevelDescription(
  levelId: string,
  resourceKind: AccessResourceKind,
): string | undefined {
  return LEVEL_DESCRIPTIONS[levelId]?.(resourceKind);
}

/** The effects a grant of these privileges on this kind of resource has. */
export function summarizeAccess(input: {
  privileges: readonly string[];
  resourceKind: AccessResourceKind;
  subjectKind?: SubjectKind | undefined;
  /** A Connection whose channel logs in by QR scan, so its Admin can log it back in. */
  qrLogin?: boolean;
}): AccessSummary {
  const held = new Set(input.privileges);
  const summary: AccessSummary = { allows: [], withholds: [], cautions: [] };
  if (input.subjectKind === "guest") {
    summary.cautions.push(i18n.t("hub.access.effects.guestCaution"));
  }
  if (input.resourceKind === "team") {
    summarizeTeamAdmin(held, summary);
    return summary;
  }
  if (input.resourceKind === "channel_account" || input.resourceKind === "automation") {
    summarizeRoutes(held, summary, input.qrLogin === true);
    return summary;
  }
  if (held.has("daemon.manage")) {
    summary.allows.push(i18n.t("hub.access.effects.operateHost"));
    summary.allows.push(i18n.t("hub.access.effects.everythingOnHost"));
    summary.allows.push(canShareDescription(input.resourceKind));
    summary.cautions.push(i18n.t("hub.access.effects.administratorCaution"));
    return summary;
  }
  summarizeProjectWork(held, input.resourceKind, summary);
  if (held.has(CAN_SHARE_PRIVILEGE)) summary.allows.push(canShareDescription(input.resourceKind));
  return summary;
}

function summarizeTeamAdmin(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (!held.has(CAN_SHARE_PRIVILEGE)) return;
  summary.allows.push(i18n.t("hub.access.effects.teamAddRemove"));
  summary.allows.push(i18n.t("hub.access.effects.teamAppoint"));
  summary.withholds.push(i18n.t("hub.access.effects.teamWithheld"));
}

function summarizeRoutes(
  held: ReadonlySet<string>,
  summary: AccessSummary,
  qrLogin: boolean,
): void {
  if (held.has("channel.manage")) {
    summary.allows.push(i18n.t("hub.access.effects.routesEdit"));
    summary.allows.push(i18n.t("hub.access.effects.routesDefaults"));
    summary.allows.push(i18n.t("hub.access.effects.routesActivity"));
    if (qrLogin) summary.allows.push(i18n.t("hub.access.effects.routesQrLogin"));
    if (held.has(CAN_SHARE_PRIVILEGE))
      summary.allows.push(i18n.t("hub.access.effects.routesAppoint"));
    // Delegation: only a change to what a Route runs is checked, against the saver's own grants.
    summary.cautions.push(i18n.t("hub.access.effects.routesDelegationCaution"));
    summary.withholds.push(i18n.t("hub.access.effects.routesNotTalking"));
    summary.withholds.push(i18n.t("hub.access.effects.routesNoToken"));
  }
  if (held.has("automation.run")) summary.allows.push(i18n.t("hub.access.effects.automationRun"));
  if (held.has("automation.run") && held.has(CAN_SHARE_PRIVILEGE)) {
    summary.allows.push(i18n.t("hub.access.effects.automationAdmin"));
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
        ? i18n.t("hub.access.effects.useEveryProject")
        : i18n.t("hub.access.effects.useProject"),
    );
    if (onHost) summary.cautions.push(i18n.t("hub.access.effects.hostGrantCaution"));
  } else if (held.has("daemon.connect")) {
    summary.allows.push(i18n.t("hub.access.effects.connectHost"));
    summary.withholds.push(i18n.t("hub.access.effects.noProject"));
    return;
  }
  allowIf(held, "agent.interact", i18n.t("hub.access.effects.chat"), summary);
  allowIf(held, "agent.create", i18n.t("hub.access.effects.startSessions"), summary);
  allowIf(held, "agent.fast.use", i18n.t("hub.access.effects.fastMode"), summary);
  allowIf(held, "workspace.create", i18n.t("hub.access.effects.createWorkspaces"), summary);
  allowIf(held, "schedule.manage", i18n.t("hub.access.effects.manageSchedules"), summary);
  allowIf(held, "terminal.use", i18n.t("hub.access.effects.shell"), summary);
  if (!held.has("terminal.use")) {
    allowIf(held, "terminal.profile.use", i18n.t("hub.access.effects.terminalProfiles"), summary);
    summary.withholds.push(i18n.t("hub.access.effects.noShell"));
  }
  summarizeApprovals(held, summary);
  summarizeManagement(held, onHost, summary);
  if (
    held.has("terminal.use") ||
    held.has("approval.command") ||
    held.has("terminal.profile.use")
  ) {
    summary.cautions.push(i18n.t("hub.access.effects.terminalCaution"));
  }
}

function summarizeApprovals(held: ReadonlySet<string>, summary: AccessSummary): void {
  if (EVERY_APPROVAL.every((privilege) => held.has(privilege))) {
    summary.allows.push(i18n.t("hub.access.effects.approveEverything"));
    summary.allows.push(i18n.t("hub.access.effects.unattended"));
    return;
  }
  allowIf(held, "approval.file", i18n.t("hub.access.effects.approveFiles"), summary);
  allowIf(held, "approval.config", i18n.t("hub.access.effects.approveConfig"), summary);
  allowIf(held, "approval.command", i18n.t("hub.access.effects.approveCommands"), summary);
  allowIf(
    held,
    "approval.command.destructive",
    i18n.t("hub.access.effects.approveDestructive"),
    summary,
  );
  allowIf(held, "approval.other", i18n.t("hub.access.effects.approveOther"), summary);
  if (!held.has("approval.command")) {
    summary.withholds.push(i18n.t("hub.access.effects.cannotApproveCommands"));
  }
}

function summarizeManagement(
  held: ReadonlySet<string>,
  onHost: boolean,
  summary: AccessSummary,
): void {
  if (!held.has("workspace.manage")) {
    if (!held.has("workspace.create")) {
      summary.withholds.push(i18n.t("hub.access.effects.cannotCreateWorkspaces"));
    }
    summary.withholds.push(i18n.t("hub.access.effects.cannotManageProjects"));
    return;
  }
  if (onHost) summary.allows.push(i18n.t("hub.access.effects.createProjects"));
  summary.allows.push(
    onHost
      ? i18n.t("hub.access.effects.manageHostProjects")
      : i18n.t("hub.access.effects.manageProject"),
  );
  summary.cautions.push(i18n.t("hub.access.effects.removeCaution"));
  if (onHost) summary.cautions.push(i18n.t("hub.access.effects.folderCaution"));
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
      ? ["agent.fast.use", CAN_SHARE_PRIVILEGE, "terminal.use", "schedule.manage"]
      : ["agent.fast.use"];
  return privileges.filter((privilege) => !flags.includes(privilege));
}

/** Effects as a bulleted text block under an optional heading, or null when there are none. */
export function effectLines(title: string | null, effects: readonly string[]): string | null {
  if (effects.length === 0) return null;
  const bullets = effects.map((effect) => `• ${effect}`);
  const heading = title === null ? [] : [i18n.t("hub.access.summary.heading", { title })];
  return [...heading, ...bullets].join("\n");
}

/** The channel of a Connection resource id: the Hub writes `<channel>/<accountId>`, URL-encoded. */
export function connectionChannel(resourceId: string): string | undefined {
  const separator = resourceId.indexOf("/");
  if (separator <= 0) return undefined;
  try {
    return decodeURIComponent(resourceId.slice(0, separator));
  } catch {
    return undefined;
  }
}

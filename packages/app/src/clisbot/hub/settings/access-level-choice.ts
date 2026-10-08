import type { SelectFieldOption } from "@/components/ui/select-field";
import { i18n } from "@/i18n/i18next";
import { confirmDialog } from "@/utils/confirm-dialog";
import { accessLevelLabel, type AccessResourceKind } from "./access-catalog";
import {
  CAN_SHARE_PRIVILEGE,
  privilegesWithinHoldings,
  type ViewerHoldings,
} from "./access-grantor";
import { accessLevelDescription } from "./access-level-summary";

/**
 * How the Can share switch behaves for the chosen level on a Host or Project
 * (docs/features/access/scoped-admins.md): Connect never shares, Administrator
 * always shares, every other level chooses; Full access starts on.
 */
export type CanShareState = "hidden" | "locked" | "optional";

export function canShareState(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
): CanShareState {
  if (resourceKind !== "daemon" && resourceKind !== "project") return "hidden";
  // The same privilege the Hub treats as implying Can share (`impliedPrivileges`).
  if (levelPrivileges.includes("daemon.manage")) return "locked";
  return levelPrivileges.includes("project.use") ? "optional" : "hidden";
}

/**
 * The Terminal (shell) switch on a Host or Project grant: offered wherever the
 * level launches Terminal profiles, and never on Administrator, which has it all
 * (docs/features/access/terminal-and-project-creation.md).
 */
export function offersTerminalSwitch(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
): boolean {
  return (
    (resourceKind === "daemon" || resourceKind === "project") &&
    !levelPrivileges.includes("daemon.manage") &&
    levelPrivileges.includes("terminal.profile.use")
  );
}

/** The level's privileges with the Terminal switch applied. */
export function withTerminal(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
  terminal: boolean,
): string[] {
  if (!offersTerminalSwitch(resourceKind, levelPrivileges)) return [...levelPrivileges];
  const without = levelPrivileges.filter((privilege) => privilege !== "terminal.use");
  return terminal ? [...without, "terminal.use"] : without;
}

export const SCHEDULE_PRIVILEGE = "schedule.manage";

/**
 * The Schedules switch on a Host or Project grant: every level that uses Projects carries it
 * as a preset the grant can switch off; Administrator has it all
 * (docs/audits/2026-10-06-conversation-schedules.md).
 */
export function offersScheduleSwitch(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
): boolean {
  return (
    (resourceKind === "daemon" || resourceKind === "project") &&
    !levelPrivileges.includes("daemon.manage") &&
    levelPrivileges.includes("project.use")
  );
}

/** The level's privileges with the Schedules switch applied. */
export function withSchedules(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
  schedules: boolean,
): string[] {
  if (!offersScheduleSwitch(resourceKind, levelPrivileges)) return [...levelPrivileges];
  const without = levelPrivileges.filter((privilege) => privilege !== SCHEDULE_PRIVILEGE);
  return schedules ? [...without, SCHEDULE_PRIVILEGE] : without;
}

/** Where a level starts its Can share, Terminal and Schedules switches: what the level names. */
export function levelSwitchPresets(levelPrivileges: readonly string[]): {
  canShare: boolean;
  terminal: boolean;
  schedules: boolean;
} {
  return {
    canShare: levelPrivileges.includes(CAN_SHARE_PRIVILEGE),
    terminal: levelPrivileges.includes("terminal.use"),
    schedules: levelPrivileges.includes(SCHEDULE_PRIVILEGE),
  };
}

/** The level's privileges with Can share applied the way the switch shows it. */
export function withCanShare(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
  canShare: boolean,
): string[] {
  if (resourceKind !== "daemon" && resourceKind !== "project") return [...levelPrivileges];
  const state = canShareState(resourceKind, levelPrivileges);
  const without = levelPrivileges.filter((privilege) => privilege !== CAN_SHARE_PRIVILEGE);
  if (state === "locked" || (state === "optional" && canShare)) {
    return [...without, CAN_SHARE_PRIVILEGE];
  }
  return without;
}

/**
 * The levels the viewer may grant on this resource, and the ones held back
 * because they exceed the viewer's own. A hidden level is not a dead choice.
 */
export function levelOptionsWithinHoldings(
  accessLevels: Record<string, readonly string[]>,
  resourceKind: AccessResourceKind,
  holdings: ViewerHoldings,
): { options: SelectFieldOption<string>[]; aboveOwn: string[] } {
  const options: SelectFieldOption<string>[] = [];
  const aboveOwn: string[] = [];
  for (const [id, privileges] of Object.entries(accessLevels)) {
    const minimal = withSchedules(
      resourceKind,
      withTerminal(resourceKind, withCanShare(resourceKind, privileges, false), false),
      false,
    );
    if (!privilegesWithinHoldings(holdings, minimal)) {
      aboveOwn.push(accessLevelLabel(id));
      continue;
    }
    options.push({
      id,
      value: id,
      label: accessLevelLabel(id),
      description: accessLevelDescription(id, resourceKind),
    });
  }
  return { options, aboveOwn };
}

/** Asks before the Administrator level is even selected; false keeps the previous level. */
export function confirmAdministratorLevel(): Promise<boolean> {
  return confirmDialog({
    title: i18n.t("hub.access.administrator.title"),
    message: i18n.t("hub.access.administrator.warning"),
    confirmLabel: i18n.t("hub.access.administrator.confirm"),
  });
}

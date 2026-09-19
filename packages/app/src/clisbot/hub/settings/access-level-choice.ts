import type { SelectFieldOption } from "@/components/ui/select-field";
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
 * (docs/features/access/scoped-admins.md): Connect never shares, Full access and
 * Administrator always share, Office worker and Developer choose.
 */
export type CanShareState = "hidden" | "locked" | "optional";

export function canShareState(
  resourceKind: AccessResourceKind,
  levelPrivileges: readonly string[],
): CanShareState {
  if (resourceKind !== "daemon" && resourceKind !== "project") return "hidden";
  // The same privileges the Hub treats as implying Can share (`impliedPrivileges`).
  if (levelPrivileges.includes("workspace.manage") || levelPrivileges.includes("daemon.manage")) {
    return "locked";
  }
  return levelPrivileges.includes("project.use") ? "optional" : "hidden";
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
    if (!privilegesWithinHoldings(holdings, withCanShare(resourceKind, privileges, false))) {
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

export const ADMINISTRATOR_WARNING =
  "This person will control the daemon: restart, install plugins, use every Model, see every Project. Organization Admins will be notified.";

/** Asks before the Administrator level is even selected; false keeps the previous level. */
export function confirmAdministratorLevel(): Promise<boolean> {
  return confirmDialog({
    title: "Grant Administrator?",
    message: ADMINISTRATOR_WARNING,
    confirmLabel: "Choose Administrator",
  });
}

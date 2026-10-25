import { useMemo } from "react";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { inScope, resolveOwnership, type OwnershipScope, type ReaderAccount } from "./ownership";
import { useReaderAccounts } from "./reader";
import { useNavigationStore, type WorkChip } from "./store";

export const WORK_CHIPS: readonly WorkChip[] = ["all", "needs", "running", "done", "failed"];

/** The workspace fields Work's chips and scope read; a subset of the sidebar entry. */
export interface WorkEntry {
  statusBucket: string;
  createdBy?: SessionActor;
}

/** Work's quick filters (brief C4) over the workspace's own status, as the sidebar dot shows it. */
export function matchesWorkChip(entry: WorkEntry, chip: WorkChip): boolean {
  if (chip === "needs") return entry.statusBucket === "needs_input";
  if (chip === "running") return entry.statusBucket === "running";
  if (chip === "failed") return entry.statusBucket === "failed";
  if (chip === "done") return entry.statusBucket === "done" || entry.statusBucket === "attention";
  return true;
}

export function workPredicate(input: {
  scope: OwnershipScope;
  chip: WorkChip;
  accounts: readonly ReaderAccount[];
}): ((entry: WorkEntry) => boolean) | null {
  if (input.scope === "all" && input.chip === "all") return null;
  return (entry) =>
    inScope(
      input.scope,
      resolveOwnership({ createdBy: entry.createdBy, accounts: input.accounts }),
    ) && matchesWorkChip(entry, input.chip);
}

/** Work's scope and chip as a filter for the shared sidebar model; null when nothing narrows. */
export function useWorkListFilter(): ((entry: WorkEntry) => boolean) | null {
  const scope = useNavigationStore((state) => state.scopes.work);
  const chip = useNavigationStore((state) => state.workChip);
  const accounts = useReaderAccounts();
  return useMemo(
    () => (NAVIGATION_V2_ENABLED ? workPredicate({ scope, chip, accounts }) : null),
    [scope, chip, accounts],
  );
}

export function countWork(
  entries: Iterable<WorkEntry>,
  scope: OwnershipScope,
  accounts: readonly ReaderAccount[],
) {
  const chips: Record<WorkChip, number> = { all: 0, needs: 0, running: 0, done: 0, failed: 0 };
  const scopes = { mine: 0, others: 0, all: 0 };
  for (const entry of entries) {
    const ownership = resolveOwnership({ createdBy: entry.createdBy, accounts });
    scopes[ownership] += 1;
    scopes.all += 1;
    if (!inScope(scope, ownership)) continue;
    for (const chip of WORK_CHIPS) if (matchesWorkChip(entry, chip)) chips[chip] += 1;
  }
  return { chips, scopes };
}

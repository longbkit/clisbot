import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { resolveOwnership, type Ownership } from "@/clisbot/navigation/ownership";
import { useReaderAccounts } from "@/clisbot/navigation/reader";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceOwnership = ReadonlyMap<string, Ownership>;

const NONE: WorkspaceOwnership = new Map();

export function workspaceOwnershipKey(serverId: string, workspaceId: string): string {
  return `${serverId}\u0000${workspaceId}`;
}

/**
 * Whose each workspace is, by the same rule Work's For me / Others tabs use: the recorded author
 * against the signed-in Hub accounts. Only workspaces that are someone else's are listed, so the
 * map stays empty, and costs nothing, for a reader with no Hub account or no Navigation V2.
 */
export function useWorkspaceOwnership(enabled: boolean): WorkspaceOwnership {
  const accounts = useReaderAccounts();
  const active = enabled && NAVIGATION_V2_ENABLED && accounts.length > 0;
  const workspaces = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, WorkspaceDescriptor> | undefined> = {};
      if (!active) return result;
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.workspaces;
      }
      return result;
    }),
  );
  return useMemo(() => {
    if (!active) return NONE;
    const others = new Map<string, Ownership>();
    for (const [serverId, byId] of Object.entries(workspaces)) {
      for (const workspace of byId?.values() ?? []) {
        if (resolveOwnership({ createdBy: workspace.createdBy, accounts }) === "others") {
          others.set(workspaceOwnershipKey(serverId, workspace.id), "others");
        }
      }
    }
    return others;
  }, [accounts, active, workspaces]);
}

export function ownershipOf(
  map: WorkspaceOwnership,
  serverId: string,
  workspaceId: string | null,
): Ownership {
  if (!workspaceId) return "mine";
  return map.get(workspaceOwnershipKey(serverId, workspaceId)) ?? "mine";
}

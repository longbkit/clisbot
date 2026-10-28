import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { resolveOwnership, type Ownership } from "@/clisbot/navigation/ownership";
import { useOwnershipHosts } from "@/clisbot/navigation/use-ownership-hosts";
import { useReaderAccounts } from "@/clisbot/navigation/reader";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceOwnership = ReadonlyMap<string, Ownership>;

const NONE: WorkspaceOwnership = new Map();

export function workspaceOwnershipKey(serverId: string, workspaceId: string): string {
  return `${serverId}\u0000${workspaceId}`;
}

/**
 * Workspace resources use their own author and Host binding. Missing resources stay unknown;
 * sessions never fall back to this map. Outside Navigation V2 the map is empty.
 */
export function useWorkspaceOwnership(enabled: boolean): WorkspaceOwnership {
  const accounts = useReaderAccounts();
  const hostKinds = useOwnershipHosts();
  const active = enabled && NAVIGATION_V2_ENABLED;
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
    const owners = new Map<string, Ownership>();
    for (const [serverId, byId] of Object.entries(workspaces)) {
      for (const workspace of byId?.values() ?? []) {
        const ownership = resolveOwnership({
          createdBy: workspace.createdBy,
          accounts,
          hostKind: hostKinds.get(serverId) ?? "unknown",
        });
        owners.set(workspaceOwnershipKey(serverId, workspace.id), ownership);
      }
    }
    return owners;
  }, [accounts, active, hostKinds, workspaces]);
}

export function ownershipOf(
  map: WorkspaceOwnership,
  serverId: string,
  workspaceId: string | null,
): Ownership {
  if (!workspaceId) return "unknown";
  return map.get(workspaceOwnershipKey(serverId, workspaceId)) ?? "unknown";
}

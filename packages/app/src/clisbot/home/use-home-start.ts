import { useMemo } from "react";
import { hostProjectFromWorkspace, type HostProjectListItem } from "@/projects/host-projects";
import { useHostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { useHasHydratedWorkspaces, useWorkspace } from "@/stores/session-store-hooks";
import type { HostProfile } from "@/types/host-connection";
import { isRememberedProjectGone, type ResolvedStart } from "./remembered-start";
import { useRememberedStart } from "./use-remembered-start";

interface HomeStartHosts {
  /** The inventory, plus the remembered Host while it is registered but not listed yet. */
  hosts: HostProfile[];
  /** Null once the remembered Host is no longer registered: only the Hub's answer removes it. */
  start: ResolvedStart | null;
}

/**
 * The Hosts Home's composer offers and the start it opens on. The remembered Host stays selected
 * while it connects, even before a Hub list makes the inventory show it.
 */
export function useHomeStartHosts(input: {
  enabled: boolean;
  inventoryHosts: HostProfile[];
  lastWorkspace: ActiveWorkspaceSelection | null;
}): HomeStartHosts {
  const { enabled, inventoryHosts, lastWorkspace } = input;
  const registered = useHosts();
  const workspace = useWorkspace(
    enabled ? (lastWorkspace?.serverId ?? null) : null,
    enabled ? (lastWorkspace?.workspaceId ?? null) : null,
  );
  const liveProject = useMemo(
    () =>
      lastWorkspace
        ? hostProjectFromWorkspace({ serverId: lastWorkspace.serverId, workspace })
        : null,
    [lastWorkspace, workspace],
  );
  const start = useRememberedStart({ enabled, lastWorkspace, liveProject });
  const rememberedHost = start
    ? (registered.find((host) => host.serverId === start.serverId) ?? null)
    : null;
  const hosts = useMemo(() => {
    if (!rememberedHost) return inventoryHosts;
    const listed = inventoryHosts.some((host) => host.serverId === rememberedHost.serverId);
    return listed ? inventoryHosts : [...inventoryHosts, rememberedHost];
  }, [inventoryHosts, rememberedHost]);
  return { hosts, start: rememberedHost ? start : null };
}

/** The remembered project, until its Host has loaded and answered without it. */
export function useHomeStartProject(
  start: ResolvedStart | null,
  projects: readonly HostProjectListItem[],
): HostProjectListItem | null {
  const serverId = start?.serverId ?? "";
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const hydrated = useHasHydratedWorkspaces(start ? serverId : null);
  if (isRememberedProjectGone({ start, projects, online, hydrated })) return null;
  return start?.project ?? null;
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { HostProjectListItem } from "@/projects/host-projects";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import {
  getLastWorkspaceSelection,
  useIsLastWorkspaceSelectionHydrated,
} from "@/stores/navigation-active-workspace-store";
import {
  createRememberedStartStore,
  isStoredStartCurrent,
  REMEMBERED_START_STORAGE_KEY,
  rememberedProjectOf,
  resolveRememberedStart,
  type RememberedStart,
  type ResolvedStart,
} from "./remembered-start";

const store = createRememberedStartStore({
  read: () => AsyncStorage.getItem(REMEMBERED_START_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(REMEMBERED_START_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(REMEMBERED_START_STORAGE_KEY),
});
void store.hydrate();

/** Store the Host and project the user just chose on Home. */
export function rememberStart(start: Omit<RememberedStart, "workspace">): void {
  store.remember({ ...start, workspace: getLastWorkspaceSelection() });
}

/**
 * The start Home opens on, from storage at once. A workspace opened since the start was stored
 * becomes the stored start when its project has loaded, so the next cold start shows it at once.
 */
export function useRememberedStart(input: {
  enabled: boolean;
  lastWorkspace: ActiveWorkspaceSelection | null;
  liveProject: HostProjectListItem | null;
}): ResolvedStart | null {
  const { enabled, lastWorkspace, liveProject } = input;
  const stored = useSyncExternalStore(store.subscribe, store.get, store.get);
  const storedHydrated = useSyncExternalStore(store.subscribe, store.isHydrated, store.isHydrated);
  const workspaceHydrated = useIsLastWorkspaceSelectionHydrated();
  useEffect(() => {
    if (!enabled || !storedHydrated || !workspaceHydrated) return;
    if (!lastWorkspace || !liveProject || isStoredStartCurrent(stored, lastWorkspace)) return;
    store.remember({
      serverId: lastWorkspace.serverId,
      project: rememberedProjectOf(liveProject, lastWorkspace.serverId, null),
      workspace: lastWorkspace,
    });
  }, [enabled, storedHydrated, workspaceHydrated, lastWorkspace, liveProject, stored]);
  return useMemo(
    () => (enabled ? resolveRememberedStart({ stored, lastWorkspace, liveProject }) : null),
    [enabled, stored, lastWorkspace, liveProject],
  );
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Which workspaces the user opened by hand, for `expansion: "manual"`.
 *
 * Local view state rather than a synced setting, the same split as the collapsed project
 * sections: which rows are open on this screen does not follow you to another device. The other
 * two expansion modes derive openness and never read this.
 *
 * Only open workspaces are stored — closing one deletes its key — so the record stays as small as
 * the set of rows you currently have open.
 */
interface WorkspaceSessionsExpansionState {
  expandedWorkspaceKeys: Record<string, true>;
  toggleWorkspaceExpanded: (workspaceKey: string) => void;
}

interface PersistedWorkspaceSessionsExpansion {
  expandedWorkspaceKeys: Record<string, true>;
}

const PersistedWorkspaceSessionsExpansionSchema: z.ZodType<PersistedWorkspaceSessionsExpansion> =
  z.looseObject({ expandedWorkspaceKeys: z.record(z.string(), z.literal(true)) });

export function toggleExpandedWorkspaceKey(
  keys: Readonly<Record<string, true>>,
  workspaceKey: string,
): Record<string, true> {
  const { [workspaceKey]: wasExpanded, ...rest } = keys;
  return wasExpanded ? rest : { ...keys, [workspaceKey]: true };
}

export const useWorkspaceSessionsExpansionStore = create<WorkspaceSessionsExpansionState>()(
  persist<WorkspaceSessionsExpansionState, [], [], PersistedWorkspaceSessionsExpansion>(
    (set) => ({
      expandedWorkspaceKeys: {},
      toggleWorkspaceExpanded: (workspaceKey) =>
        set((state) => ({
          expandedWorkspaceKeys: toggleExpandedWorkspaceKey(
            state.expandedWorkspaceKeys,
            workspaceKey,
          ),
        })),
    }),
    {
      name: "sidebar-workspace-sessions-expansion",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        PersistedWorkspaceSessionsExpansionSchema,
      ),
      partialize: (state) => ({ expandedWorkspaceKeys: state.expandedWorkspaceKeys }),
    },
  ),
);

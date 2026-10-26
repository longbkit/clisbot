import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** A device view preference, never part of daemon or synced Bot configuration. */
export const useBotProjectsPreference = create<{
  showBotProjects: boolean;
  toggleBotProjects: () => void;
}>()(
  persist(
    (set) => ({
      showBotProjects: true,
      toggleBotProjects: () => set((state) => ({ showBotProjects: !state.showBotProjects })),
    }),
    {
      name: "sidebar-bot-projects",
      version: 1,
      // The former section stored an unused, default-off visibility flag. Start the merged
      // Projects list visible rather than hiding it because of that obsolete section state.
      migrate: () => ({ showBotProjects: true }),
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          showBotProjects: z.boolean().catch(true),
        }),
      ),
      partialize: (state) => ({
        showBotProjects: state.showBotProjects,
      }),
    },
  ),
);

/**
 * Whether the Home V2 sidebar's project list shows Bot home projects. Navigation V2 decides per
 * session instead (the Workspace list's Bots chip), so this switch belongs to the old layout only.
 */
export function useShowBotProjects(): { visible: boolean; toggle: () => void } {
  const visible = useBotProjectsPreference((state) => state.showBotProjects);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjects);
  return { visible, toggle };
}

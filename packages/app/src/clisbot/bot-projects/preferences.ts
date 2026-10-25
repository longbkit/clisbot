import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { useNavigationStore } from "@/clisbot/navigation/store";

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
 * Whether the project list shows Bot home projects. Navigation V2's Work keeps its own switch,
 * off by default (Bot sessions live in Chats), so the Home V2 sidebar's stored choice is untouched.
 */
export function useShowBotProjects(): { visible: boolean; toggle: () => void } {
  const legacy = useBotProjectsPreference((state) => state.showBotProjects);
  const toggleLegacy = useBotProjectsPreference((state) => state.toggleBotProjects);
  const work = useNavigationStore((state) => state.showBotProjectsInWork);
  const toggleWork = useNavigationStore((state) => state.toggleBotProjectsInWork);
  return NAVIGATION_V2_ENABLED
    ? { visible: work, toggle: toggleWork }
    : { visible: legacy, toggle: toggleLegacy };
}

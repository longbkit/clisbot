import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** A device view preference, never part of daemon or synced Bot configuration. */
export const useBotProjectsPreference = create<{
  showBotProjects: boolean;
  botProjectsCollapsed: boolean;
  toggleBotProjectsCollapsed: () => void;
  toggleBotProjects: () => void;
}>()(
  persist(
    (set) => ({
      showBotProjects: false,
      botProjectsCollapsed: true,
      toggleBotProjectsCollapsed: () =>
        set((state) => ({ botProjectsCollapsed: !state.botProjectsCollapsed })),
      toggleBotProjects: () => set((state) => ({ showBotProjects: !state.showBotProjects })),
    }),
    {
      name: "sidebar-bot-projects",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          showBotProjects: z.boolean().catch(false),
          botProjectsCollapsed: z.boolean().catch(true),
        }),
      ),
      partialize: (state) => ({
        showBotProjects: state.showBotProjects,
        botProjectsCollapsed: state.botProjectsCollapsed,
      }),
    },
  ),
);

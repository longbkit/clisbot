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

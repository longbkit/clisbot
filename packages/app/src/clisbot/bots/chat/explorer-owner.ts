import { create } from "zustand";
/** A chat uses the existing compact Explorer overlay without pretending to be a workspace route. */
export const useConversationExplorerOwner = create<{
  owner: string | null;
  /**
   * The focused chat whose Explorer can open now (it has a project folder). The app's swipe
   * from right to left opens it, as it does a session's (`mobile-panels/explorer-open-gesture`).
   */
  openable: string | null;
  setOwner: (owner: string | null) => void;
  setOpenable: (openable: string | null) => void;
}>((set) => ({
  owner: null,
  openable: null,
  setOwner: (owner) => set({ owner }),
  setOpenable: (openable) => set({ openable }),
}));

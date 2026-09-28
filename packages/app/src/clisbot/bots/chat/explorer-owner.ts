import { create } from "zustand";
/** A chat uses the existing compact Explorer overlay without pretending to be a workspace route. */
export const useConversationExplorerOwner = create<{
  owner: string | null;
  setOwner: (owner: string | null) => void;
}>((set) => ({ owner: null, setOwner: (owner) => set({ owner }) }));

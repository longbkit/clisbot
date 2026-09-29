import { create } from "zustand";

/**
 * Asks the sidebar to open New bot or New group chat from elsewhere, such as the Command Center.
 * The sidebar owns the creation sheets; it takes the request and clears it.
 */
export type CreationRequest = "bot" | "group" | null;

export const useCreationRequest = create<{
  request: CreationRequest;
  ask: (request: Exclude<CreationRequest, null>) => void;
  take: () => void;
}>((set) => ({
  request: null,
  ask: (request) => set({ request }),
  take: () => set({ request: null }),
}));

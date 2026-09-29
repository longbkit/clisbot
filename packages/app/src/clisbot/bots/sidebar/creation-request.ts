import { create } from "zustand";

/**
 * Asks the sidebar to open New bot or New group chat from elsewhere, such as the Command Center.
 * The sidebar owns the creation sheets, and it is not always mounted (workspace focus mode, some
 * phone routes), so it registers while it can take a request; nobody may ask otherwise, and a
 * request is never left waiting to open a sheet later.
 */
export type CreationRequest = "bot" | "group" | null;

export const useCreationRequest = create<{
  request: CreationRequest;
  /** Mounted sidebars that can open the sheets. */
  handlers: number;
  ask: (request: Exclude<CreationRequest, null>) => void;
  take: () => void;
  register: () => () => void;
}>((set, get) => ({
  request: null,
  handlers: 0,
  ask: (request) => {
    if (get().handlers > 0) set({ request });
  },
  take: () => set({ request: null }),
  register: () => {
    set((state) => ({ handlers: state.handlers + 1 }));
    return () => set((state) => ({ handlers: state.handlers - 1, request: null }));
  },
}));

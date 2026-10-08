import { create } from "zustand";
import type { BotFromProject } from "../create/bot-form-model";

/**
 * Asks the sidebar to open New bot or New group chat from elsewhere, such as the Command Center.
 * The sidebar owns the creation sheets, and it is not always mounted (workspace focus mode, some
 * phone routes), so it registers while it can take a request; nobody may ask otherwise, and a
 * request is never left waiting to open a sheet later.
 */
export type CreationRequest = "bot" | "group" | null;

export const useCreationRequest = create<{
  request: CreationRequest;
  /** New bot opened from a Project's menu: the bot is made from that Project. */
  project: BotFromProject | null;
  /** Mounted sidebars that can open the sheets. */
  handlers: number;
  ask: (request: Exclude<CreationRequest, null>, options?: { project?: BotFromProject }) => void;
  take: () => void;
  register: () => () => void;
}>((set, get) => ({
  request: null,
  project: null,
  handlers: 0,
  ask: (request, options) => {
    if (get().handlers > 0) set({ request, project: options?.project ?? null });
  },
  take: () => set({ request: null, project: null }),
  register: () => {
    set((state) => ({ handlers: state.handlers + 1 }));
    return () => set((state) => ({ handlers: state.handlers - 1, request: null, project: null }));
  },
}));

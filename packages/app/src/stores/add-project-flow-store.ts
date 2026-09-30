import type { AddProjectFlowState } from "@/add-project-flow/model";
import { create } from "zustand";

export interface AddProjectFlowRequest {
  id: number;
  preferredHostId?: string;
}

interface AddProjectDraft {
  state: AddProjectFlowState;
  browsing: boolean;
  directoryPath: string;
}

interface AddProjectFlowStoreState {
  draft: AddProjectDraft | null;
  saveDraft: (requestId: number, draft: AddProjectDraft) => void;
  request: AddProjectFlowRequest | null;
  open: (preferredHostId?: string) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set, get) => ({
  draft: null,
  saveDraft: (requestId, draft) => {
    if (get().request?.id === requestId) set({ draft });
  },
  request: null,
  open: (preferredHostId) => {
    set({
      draft: null,
      request: {
        id: nextRequestId++,
        ...(preferredHostId ? { preferredHostId } : {}),
      },
    });
  },
  close: () => set({ request: null, draft: null }),
}));

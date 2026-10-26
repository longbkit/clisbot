import { createContext, useContext } from "react";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { WorkspaceSessionItem } from "./select-sessions";

/**
 * Which session lines a list shows, decided by whoever owns the list (Navigation V2's Workspace
 * scope, chip and Bots chip). Null shows every line, as the Home V2 sidebar does.
 */
export type WorkspaceSessionFilter = (
  session: WorkspaceSessionItem,
  workspace: { createdBy?: SessionActor },
) => boolean;

const WorkspaceSessionFilterContext = createContext<WorkspaceSessionFilter | null>(null);

export const WorkspaceSessionFilterProvider = WorkspaceSessionFilterContext.Provider;

export function useWorkspaceSessionFilter(): WorkspaceSessionFilter | null {
  return useContext(WorkspaceSessionFilterContext);
}

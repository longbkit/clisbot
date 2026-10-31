import { useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useHeldWhileInactive } from "./use-held-while-inactive";
import { useSessionStore } from "@/stores/session-store";
import {
  areSidebarWorkspaceSessionsEqual,
  buildSidebarWorkspaceEntries,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

const EMPTY_ENTRIES = new Map<string, SidebarWorkspaceEntry>();
const EMPTY_SESSIONS: SidebarWorkspaceSession[] = [];
const EMPTY_PENDING_CREATE_ATTEMPTS: Record<string, never> = {};

/**
 * `live: false` (a hidden retained pane) holds the inputs, so the entries it built, at mount or
 * before it was hidden, stay as they are; `enabled: false` stops reading them at all.
 */
export function useSidebarWorkspaceEntries(
  placements: readonly SidebarWorkspacePlacement[],
  enabled = true,
  live = true,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  const serverIds = useMemo(
    () => Array.from(new Set(placements.map((placement) => placement.serverId))),
    [placements],
  );
  const sessions = useHeldWhileInactive(
    useStoreWithEqualityFn(
      useSessionStore,
      (state) =>
        enabled ? selectSidebarWorkspaceSessions(state.sessions, serverIds) : EMPTY_SESSIONS,
      areSidebarWorkspaceSessionsEqual,
    ),
    live,
  );
  const pendingCreateAttempts = useHeldWhileInactive(
    useCreateFlowStore((state) =>
      enabled ? state.pendingByDraftId : EMPTY_PENDING_CREATE_ATTEMPTS,
    ),
    live,
  );
  const previousEntriesRef = useRef<ReadonlyMap<string, SidebarWorkspaceEntry>>(EMPTY_ENTRIES);

  // Collection ownership is intentional: retained sidebars have one cheap
  // subscription to structurally shared indexes, never one session-store
  // subscription per mounted row.
  return useMemo(() => {
    if (!enabled) {
      return previousEntriesRef.current;
    }
    if (placements.length === 0 || sessions.length === 0) {
      previousEntriesRef.current = EMPTY_ENTRIES;
      return EMPTY_ENTRIES;
    }
    const entries = buildSidebarWorkspaceEntries({
      placements,
      sessions,
      pendingCreateAttempts,
      previousEntries: previousEntriesRef.current,
    });
    previousEntriesRef.current = entries;
    return entries;
  }, [enabled, pendingCreateAttempts, placements, sessions]);
}

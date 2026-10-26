import { useEffect } from "react";
import { usePathname } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { getChatIdFromLabels } from "@clisbot/protocol/bots/labels";
import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { useSessionStore } from "@/stores/session-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";

export interface OpenedSession {
  serverId: string;
  agentId: string;
}

interface Labeled {
  id: string;
  labels?: Record<string, string>;
  lastActivityAt: Date;
}

/** A Bot chat's session: the chat's most recently active agent. */
export function chatSessionAgent(agents: Iterable<Labeled>, chatId: string): string | null {
  let latest: Labeled | null = null;
  for (const agent of agents) {
    if (getChatIdFromLabels(agent.labels) !== chatId) continue;
    if (!latest || agent.lastActivityAt.getTime() > latest.lastActivityAt.getTime()) latest = agent;
  }
  return latest?.id ?? null;
}

const OpenedSessionSchema = z.object({ serverId: z.string(), agentId: z.string() });

/**
 * The session on screen, and the last one opened: what a phone shows once it has left it, kept
 * across restarts. Only ids are stored.
 */
interface OpenedSessionState {
  current: OpenedSession | null;
  last: OpenedSession | null;
}

const useOpenedSessionStore = create<OpenedSessionState>()(
  persist((): OpenedSessionState => ({ current: null, last: null }), {
    name: "clisbot-last-opened-session",
    version: 1,
    storage: createValidatedPersistStorage(
      AsyncStorage,
      z.object({ last: OpenedSessionSchema.nullable() }),
    ),
    partialize: (state) => ({ last: state.last }),
  }),
);

function same(a: OpenedSession | null, b: OpenedSession | null) {
  return a?.serverId === b?.serverId && a?.agentId === b?.agentId;
}

function useRouteSession(): OpenedSession | null {
  const pathname = usePathname();
  const workspace = parseHostWorkspaceRouteFromPathname(pathname);
  const chat = workspace ? null : parseChatRouteFromPathname(pathname);
  const serverId = workspace?.serverId ?? chat?.serverId ?? null;
  const agentId = useSessionStore((state) => {
    if (!serverId) return null;
    const session = state.sessions[serverId];
    if (!session) return null;
    if (workspace) return session.focusedAgentId;
    return chat ? chatSessionAgent(session.agents.values(), chat.chatId) : null;
  });
  return serverId && agentId ? { serverId, agentId } : null;
}

/** Keeps the opened session up to date; mounted once, with the Navigation V2 chrome. */
export function useTrackOpenedSession(): void {
  const route = useRouteSession();
  const serverId = route?.serverId ?? null;
  const agentId = route?.agentId ?? null;
  useEffect(() => {
    const next = serverId && agentId ? { serverId, agentId } : null;
    const state = useOpenedSessionStore.getState();
    if (same(state.current, next) && (!next || same(state.last, next))) return;
    useOpenedSessionStore.setState({ current: next, last: next ?? state.last });
  }, [serverId, agentId]);
}

/** The session on screen right now (a workspace's focused session, or a Bot chat's). */
export function useCurrentSession(): OpenedSession | null {
  return useOpenedSessionStore((state) => state.current);
}

/** The most recently opened session, even after the reader left it. */
export function useLastOpenedSession(): OpenedSession | null {
  return useOpenedSessionStore((state) => state.last);
}

import { useEffect } from "react";
import { useRoutePath } from "@/navigation/route-source";
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

/** A workspace route's Host, or a chat route's Host and chat. */
interface SessionRoute {
  serverId: string;
  chatId: string | null;
}

function sessionRoute(pathname: string): SessionRoute | null {
  const workspace = parseHostWorkspaceRouteFromPathname(pathname);
  if (workspace) return { serverId: workspace.serverId, chatId: null };
  const chat = parseChatRouteFromPathname(pathname);
  return chat ? { serverId: chat.serverId, chatId: chat.chatId } : null;
}

function sameSessionRoute(a: SessionRoute | null, b: SessionRoute | null): boolean {
  return a?.serverId === b?.serverId && a?.chatId === b?.chatId;
}

function useRouteSession(): OpenedSession | null {
  // Mounted with the chrome: a tab switch or an app page must not re-render it.
  const route = useRoutePath(sessionRoute, sameSessionRoute);
  const serverId = route?.serverId ?? null;
  const chatId = route?.chatId ?? null;
  const agentId = useSessionStore((state) => {
    if (!serverId) return null;
    const session = state.sessions[serverId];
    if (!session) return null;
    if (chatId === null) return session.focusedAgentId;
    return chatSessionAgent(session.agents.values(), chatId);
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

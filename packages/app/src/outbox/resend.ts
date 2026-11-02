import { isHostRuntimeConnected, type HostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { restoreAgentOutbox, retryAgentSend } from "./agent-delivery";
import { retainOutboxAttachments } from "./attachment-retention";
import { dueChatEntries, retryChatSend } from "./chat-delivery";
import { useOutboxStore } from "./store";

function outboxServerIds(): Set<string> {
  return new Set(
    Object.values(useOutboxStore.getState().entries).map((entry) => entry.target.serverId),
  );
}

function sessionsWithClient(): string {
  const sessions = useSessionStore.getState().sessions;
  return Object.keys(sessions)
    .filter((serverId) => sessions[serverId]?.client)
    .join("\u0000");
}

/** Puts unsent rows back and sends what is due, each under its own original id. */
function resendServer(serverId: string): void {
  for (const id of restoreAgentOutbox(serverId)) void retryAgentSend(id);
  for (const id of dueChatEntries(serverId)) void retryChatSend(id);
}

/**
 * Sends the outbox when a Host comes online: messages cut off by a restart and messages that
 * waited for the Host. A Host's dedupe by message id makes a resend of a delivered message a
 * no-op, so the outbox never has to guess whether the first attempt arrived.
 */
export function startOutboxResend(store: HostRuntimeStore): () => void {
  const online = new Map<string, boolean>();
  const check = () => {
    if (!useOutboxStore.persist.hasHydrated()) return;
    const sessions = useSessionStore.getState().sessions;
    for (const serverId of outboxServerIds()) {
      const isOnline =
        isHostRuntimeConnected(store.getSnapshot(serverId)) && Boolean(sessions[serverId]?.client);
      const wasOnline = online.get(serverId) ?? false;
      online.set(serverId, isOnline);
      if (isOnline && !wasOnline) resendServer(serverId);
    }
  };
  const hydrated = () => {
    for (const entry of Object.values(useOutboxStore.getState().entries)) {
      retainOutboxAttachments(entry);
    }
    check();
  };
  if (useOutboxStore.persist.hasHydrated()) hydrated();
  const unsubscribers = [
    useOutboxStore.persist.onFinishHydration(hydrated),
    store.subscribeAll(check),
    useSessionStore.subscribe(sessionsWithClient, check),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

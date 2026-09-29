import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { buildHostBotRoute } from "../routes";
import { useResourcePins } from "../sidebar/pins";
import type { BotPayload } from "../data/contracts";
import { refreshBotsAndChatsNow } from "../data/runtime";
import { chatResourceActions, type ChatResourceActionId } from "./chat-resource-actions";
import { useArchiveChat } from "./use-archive-chat";

type HostClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

/** One change at a time: `busy` while it runs, its failure in `error`. */
function useSerialTask(client: HostClient | null) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (task: (client: HostClient) => Promise<unknown>) => {
      if (!client || busy) return;
      setBusy(true);
      setError(null);
      try {
        await task(client);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, client],
  );
  return { error, setError, busy, run };
}

/** Participant toggling and Archive chat…, sharing one busy flag and one error. */
export function useChatMembership(serverId: string, chat: ChatPayload) {
  const client = useHostRuntimeClient(serverId);
  const task = useSerialTask(client);
  const { run } = task;
  const toggleParticipant = useCallback(
    (botId: string) =>
      run(async (host) => {
        const exists = chat.participants.some((p) => p.botId === botId);
        if (exists && chat.participants.length === 1)
          throw new Error("A chat needs at least one bot");
        const r = exists
          ? await host.removeChatParticipant({ chatId: chat.id, botId })
          : await host.addChatParticipant({ chatId: chat.id, botId });
        if (r.error) throw new Error(r.error);
        // Stay busy until the chat refetches, so the next change reads who is in it now.
        await refreshBotsAndChatsNow();
      }),
    [chat, run],
  );
  const archiveChat = useArchiveChat();
  const archive = useCallback(
    () => run(() => archiveChat(serverId, chat.id)),
    [archiveChat, chat.id, run, serverId],
  );
  return { ...task, connected: client !== null, toggleParticipant, archive };
}

/** The chat's own actions (pin, settings, archive) and what selecting each one does. */
export function useChatResourceMenu(input: {
  serverId: string;
  chat: ChatPayload;
  bots: BotPayload[];
  group: boolean;
  close: () => void;
  openGroupSettings: () => void;
  archive: () => Promise<void>;
}) {
  const { serverId, chat, bots, group, close, openGroupSettings, archive } = input;
  const router = useRouter();
  const pinChats = useMemo(() => [{ ...chat, serverId }], [chat, serverId]);
  const { toggle: togglePin, isPinned } = useResourcePins(pinChats);
  const pin = useMemo(
    () => ({ kind: "chat" as const, serverId, id: chat.id }),
    [serverId, chat.id],
  );
  const pinned = isPinned(pin);
  const directBot = !group ? bots.find((bot) => bot.id === chat.participants[0]?.botId) : undefined;
  const configureBot = useCallback(() => {
    if (!directBot?.canConfigure) return;
    close();
    router.push(buildHostBotRoute(serverId, directBot.id));
  }, [directBot, close, router, serverId]);
  const actions = useMemo(
    () =>
      chatResourceActions({
        target: group ? "group" : "direct",
        pinned,
        canConfigureBot: directBot?.canConfigure,
      }),
    [group, pinned, directBot?.canConfigure],
  );
  const runAction = useCallback(
    (id: ChatResourceActionId) => {
      if (id === "pin") return togglePin(pin);
      if (id === "bot-settings") return configureBot();
      if (id === "group-settings") return openGroupSettings();
      void archive();
    },
    [archive, togglePin, pin, configureBot, openGroupSettings],
  );
  return { actions, runAction };
}

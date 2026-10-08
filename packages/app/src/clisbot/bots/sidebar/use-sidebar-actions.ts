import { useCallback, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { refreshBotsAndChats } from "../data/runtime";
import { buildHostChatRoute } from "../routes";
import type { HostTagged } from "../data/aggregate";
import type { ChatPayload } from "../data/contracts";
import { directChatForBot } from "./sidebar-model";
export function useBotSidebarActions(
  chatRows: readonly HostTagged<ChatPayload>[],
  onBeforeNavigate?: () => void,
  chatsLoaded = true,
) {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
  const navigate = useCallback(
    (serverId: string, chatId: string) => {
      onBeforeNavigate?.();
      router.push(buildHostChatRoute(serverId, chatId));
    },
    [onBeforeNavigate, router],
  );
  const openBot = useCallback(
    async (serverId: string, botId: string) => {
      if (opening.current) return;
      if (!chatsLoaded) {
        setError(t("bots.workspace.errors.chatsLoading"));
        return;
      }
      opening.current = true;
      setError(null);
      try {
        const existing = directChatForBot(chatRows, serverId, botId);
        if (existing) {
          navigate(serverId, existing.id);
          return;
        }
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) throw new Error(t("bots.workspace.errors.hostDisconnected"));
        const latest = await client.listChats();
        if (latest.error) throw new Error(latest.error);
        const direct = latest.chats.find(
          (chat) =>
            (chat.kind ? chat.kind === "direct" : chat.participants.length === 1) &&
            chat.participants[0]?.botId === botId,
        );
        if (direct) {
          navigate(serverId, direct.id);
          return;
        }
        const result = await client.createChat({ botIds: [botId], kind: "direct" });
        if (result.error || !result.chat)
          throw new Error(result.error ?? t("bots.workspace.errors.openChatFailed"));
        refreshBotsAndChats();
        navigate(serverId, result.chat.id);
      } catch (e) {
        setError(String(e));
      } finally {
        opening.current = false;
      }
    },
    [chatRows, navigate, chatsLoaded, t],
  );
  return { openBot, navigate, error };
}

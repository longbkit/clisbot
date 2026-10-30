import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useReadRoutePath } from "@/navigation/route-source";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { confirmDialog } from "@/utils/confirm-dialog";
import { refreshBotsAndChats } from "../data/runtime";
import { parseChatRouteFromPathname } from "../routes";

/**
 * Archive chat…, from any menu: confirm, archive, refresh the lists, and leave the chat when it
 * is the one open. Resolves `true` when the chat was archived; throws the Host's error.
 */
export function useArchiveChat() {
  const { t } = useTranslation();
  const router = useRouter();
  const readPathname = useReadRoutePath();
  return useCallback(
    async (serverId: string, chatId: string): Promise<boolean> => {
      const confirmed = await confirmDialog({
        title: t("bots.chat.archive.title"),
        message: t("bots.chat.archive.message"),
        confirmLabel: t("bots.chat.archive.confirm"),
        destructive: true,
      });
      if (!confirmed) return false;
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("bots.chat.common.hostDisconnected"));
      const result = await client.archiveChat({ chatId });
      if (result.error) throw new Error(result.error);
      refreshBotsAndChats();
      const open = parseChatRouteFromPathname(readPathname());
      if (open?.serverId === serverId && open.chatId === chatId)
        router.replace(buildHostRootRoute(serverId));
      return true;
    },
    [readPathname, router, t],
  );
}

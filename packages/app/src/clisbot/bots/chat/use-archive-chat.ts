import { useCallback } from "react";
import { usePathname, useRouter } from "expo-router";
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
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    async (serverId: string, chatId: string): Promise<boolean> => {
      const confirmed = await confirmDialog({
        title: "Archive this chat?",
        message: "It will leave the active list. The transcript is kept.",
        confirmLabel: "Archive chat",
        destructive: true,
      });
      if (!confirmed) return false;
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error("Host is disconnected");
      const result = await client.archiveChat({ chatId });
      if (result.error) throw new Error(result.error);
      refreshBotsAndChats();
      const open = parseChatRouteFromPathname(pathname);
      if (open?.serverId === serverId && open.chatId === chatId)
        router.replace(buildHostRootRoute(serverId));
      return true;
    },
    [pathname, router],
  );
}

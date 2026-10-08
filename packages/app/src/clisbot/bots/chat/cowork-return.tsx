import { useCallback } from "react";
import { create } from "zustand";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { botsSessionScope } from "../data/session-scope";
import { buildHostChatRoute } from "../routes";
import { ChatHeaderAction } from "./header-action";

interface Origin {
  serverId: string;
  workspaceId: string;
  chatId: string;
  scope: string;
}
const useCoworkOrigin = create<{ origin: Origin | null }>(() => ({ origin: null }));
export function rememberCoworkOrigin(input: {
  serverId: string;
  agentId: string;
  chatId: string;
  scope: string;
  workspaceId?: string;
}) {
  const session = useSessionStore.getState().sessions[input.serverId];
  const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
  const workspaceId = agent?.workspaceId ?? input.workspaceId;
  useCoworkOrigin.setState({ origin: workspaceId ? { ...input, workspaceId } : null });
}
export function BackToChatAction({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const origin = useCoworkOrigin((state) => state.origin);
  const snapshot = useHostRuntimeSnapshot(serverId);
  const goBack = useCallback(() => {
    if (!origin) return;
    router.navigate(buildHostChatRoute(serverId, origin.chatId));
    useCoworkOrigin.setState({ origin: null });
  }, [origin, serverId]);
  if (
    !origin ||
    origin.serverId !== serverId ||
    origin.workspaceId !== workspaceId ||
    origin.scope !== botsSessionScope(snapshot)
  )
    return null;
  return (
    <ChatHeaderAction
      label={t("bots.chat.cowork.backToChat")}
      text={t("bots.chat.common.chat")}
      icon={ArrowLeft}
      onPress={goBack}
    />
  );
}

import { useMemo, useRef, useState } from "react";
import type { View } from "react-native";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useWorkspaceCheckoutStatus } from "@/screens/workspace/use-workspace-checkout-status";
import type { ChatBotIdentity } from "./chat-rows";
export function useConversationProject(
  serverId: string,
  bots: readonly ChatBotIdentity[],
  focused: boolean,
) {
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const chooserAnchorRef = useRef<View>(null);
  const [chooser, setChooser] = useState(false);
  const selectedBot = bots.find((bot) => bot.botId === selectedBotId) ?? bots[0];
  const workspace = useWorkspace(serverId, selectedBot?.workspaceId ?? null);
  const source = useMemo(
    () =>
      workspace && selectedBot?.workspaceId
        ? { serverId, workspaceId: selectedBot.workspaceId }
        : null,
    [serverId, workspace, selectedBot?.workspaceId],
  );
  const cwd = workspace?.workspaceDirectory ?? null;
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeIsConnected(serverId);
  const { checkoutQuery } = useWorkspaceCheckoutStatus({
    client,
    isConnected: online,
    isRouteFocused: focused && !!source,
    normalizedServerId: serverId,
    normalizedWorkspaceId: source?.workspaceId ?? "",
    workspaceDirectory: cwd,
  });
  const isGit = checkoutQuery.data?.isGit ?? workspace?.projectKind === "git";
  return {
    source,
    cwd,
    isGit,
    selectedBot,
    chooser,
    chooserAnchorRef,
    setChooser,
    setSelectedBotId,
  };
}

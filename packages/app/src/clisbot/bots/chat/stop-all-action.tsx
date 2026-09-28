import { useCallback, useState } from "react";
import { OctagonX } from "lucide-react-native";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { ChatHeaderAction } from "./header-action";

/**
 * Stop all (docs/features/bots-and-chats/plans/group-discussion.md): ends the group discussion
 * and interrupts every bot turn in the chat. Shown only while a bot in the group is working.
 */
export function StopAllAction({
  serverId,
  chatId,
  working,
  onError,
}: {
  serverId: string;
  chatId: string;
  working: boolean;
  onError: (message: string) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const [stopping, setStopping] = useState(false);
  const stop = useCallback(() => {
    if (!client || stopping) return;
    setStopping(true);
    void (async () => {
      try {
        const response = await client.stopChatDiscussion(chatId);
        if (response.error) onError(response.error);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setStopping(false);
      }
    })();
  }, [chatId, client, onError, stopping]);
  if (!working) return null;
  return (
    <ChatHeaderAction
      label="Stop all bots"
      text="Stop all"
      icon={OctagonX}
      onPress={stop}
      disabled={!online || stopping}
    />
  );
}

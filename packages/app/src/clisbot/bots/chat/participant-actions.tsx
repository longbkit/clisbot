import { useCallback } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { ChatParticipantPayload } from "@getpaseo/protocol/chats/types";
import { Button } from "@/components/ui/button";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildHostBotRoute } from "../routes";

export function ParticipantActions({
  serverId,
  participant,
}: {
  serverId: string;
  participant: ChatParticipantPayload;
}) {
  const router = useRouter();
  const settings = useCallback(
    () => router.push(buildHostBotRoute(serverId, participant.botId)),
    [participant.botId, router, serverId],
  );
  const cowork = useCallback(() => {
    if (participant.agentId) navigateToAgent({ serverId, agentId: participant.agentId });
  }, [participant.agentId, serverId]);
  return (
    <View>
      <Button variant="ghost" onPress={settings}>
        {participant.displayName}
      </Button>
      {participant.agentId ? (
        <Button variant="outline" onPress={cowork}>
          Open in cowork
        </Button>
      ) : null}
    </View>
  );
}

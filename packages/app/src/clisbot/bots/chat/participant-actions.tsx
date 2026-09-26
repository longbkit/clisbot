import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { Monitor } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatParticipantPayload } from "@getpaseo/protocol/chats/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { ChatHeaderAction } from "./header-action";

export function ParticipantActions({
  serverId,
  participants,
  group = false,
}: {
  serverId: string;
  participants: readonly ChatParticipantPayload[];
  group?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const close = useCallback(() => setVisible(false), []);
  const header = useMemo(() => ({ title: "Open in cowork" }), []);
  const open = useCallback(() => {
    const direct = participants[0];
    if (!group && participants.length === 1 && direct?.agentId) {
      navigateToAgent({ serverId, agentId: direct.agentId });
    } else setVisible(true);
  }, [group, participants, serverId]);
  return (
    <>
      <ChatHeaderAction label="Open in cowork" icon={Monitor} onPress={open} />
      <AdaptiveModalSheet visible={visible} onClose={close} header={header}>
        <View style={styles.body}>
          {participants.map((participant) => (
            <CoworkParticipant
              key={participant.botId}
              serverId={serverId}
              participant={participant}
              onOpen={close}
            />
          ))}
        </View>
      </AdaptiveModalSheet>
    </>
  );
}
function CoworkParticipant({
  serverId,
  participant,
  onOpen,
}: {
  serverId: string;
  participant: ChatParticipantPayload;
  onOpen: () => void;
}) {
  const open = useCallback(() => {
    if (!participant.agentId) return;
    onOpen();
    navigateToAgent({ serverId, agentId: participant.agentId });
  }, [onOpen, participant.agentId, serverId]);
  return (
    <View>
      <Button variant="ghost" disabled={!participant.agentId} onPress={open}>
        {participant.displayName}
      </Button>
      {!participant.agentId ? (
        <Text style={styles.hint}>Send a message to start this bot’s session.</Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

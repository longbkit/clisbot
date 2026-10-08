import { useConversationProjectContext } from "./conversation-project-context";
import { rememberCoworkOrigin } from "./cowork-return";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { botsSessionScope } from "../data/session-scope";
import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { PanelsTopLeft } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatParticipantPayload } from "@clisbot/protocol/chats/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { ChatHeaderAction } from "./header-action";

export function ParticipantActions({
  serverId,
  chatId,
  participants,
  workspaceByBotId,
  group = false,
}: {
  serverId: string;
  chatId?: string;
  participants: readonly ChatParticipantPayload[];
  workspaceByBotId?: ReadonlyMap<string, string>;
  group?: boolean;
}) {
  const { t } = useTranslation();
  const project = useConversationProjectContext();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const scope = botsSessionScope(snapshot);
  const remember = useCallback(
    (agentId: string) => {
      if (chatId)
        rememberCoworkOrigin({
          serverId,
          chatId,
          agentId,
          scope,
          workspaceId:
            workspaceByBotId?.get(
              participants.find((participant) => participant.agentId === agentId)?.botId ?? "",
            ) ?? project?.workspaceId,
        });
    },
    [chatId, scope, serverId, project?.workspaceId, participants, workspaceByBotId],
  );
  const [visible, setVisible] = useState(false);
  const close = useCallback(() => setVisible(false), []);
  const header = useMemo(() => ({ title: t("bots.chat.common.openInCowork") }), [t]);
  const open = useCallback(() => {
    const direct = project?.botId
      ? participants.find((p) => p.botId === project.botId)
      : participants[0];
    if ((project?.botId || (!group && participants.length === 1)) && direct?.agentId) {
      remember(direct.agentId);
      navigateToAgent({ serverId, agentId: direct.agentId });
    } else setVisible(true);
  }, [group, participants, serverId, remember, project?.botId]);
  return (
    <>
      <ChatHeaderAction
        label={t("bots.chat.common.openInCowork")}
        text={t("bots.chat.cowork.text")}
        icon={PanelsTopLeft}
        onPress={open}
      />
      <AdaptiveModalSheet visible={visible} onClose={close} header={header}>
        <View style={styles.body}>
          {participants.map((participant) => (
            <CoworkParticipant
              key={participant.botId}
              serverId={serverId}
              participant={participant}
              onOpen={close}
              onRemember={remember}
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
  onRemember,
}: {
  serverId: string;
  participant: ChatParticipantPayload;
  onOpen: () => void;
  onRemember: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    if (!participant.agentId) return;
    onRemember(participant.agentId);
    onOpen();
    navigateToAgent({ serverId, agentId: participant.agentId });
  }, [onOpen, onRemember, participant.agentId, serverId]);
  return (
    <View>
      <Button variant="ghost" disabled={!participant.agentId} onPress={open}>
        {participant.displayName}
      </Button>
      {!participant.agentId ? (
        <Text style={styles.hint}>{t("bots.chat.cowork.startSession")}</Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

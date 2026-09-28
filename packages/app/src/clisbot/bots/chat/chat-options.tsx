import { ConversationProjectActions } from "./conversation-project-actions";
import { Ellipsis } from "lucide-react-native";
import { ChatHeaderAction } from "./header-action";
import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { SettingsCard, SettingsRow, SettingsSection, SettingsAction } from "@/components/settings";
import { ChatParticipantSettings } from "./chat-participant-settings";
import { buildHostBotRoute } from "../routes";
import { useResourcePins, pinKey } from "../sidebar/pins";
import type { BotPayload } from "../data/contracts";
import { refreshBotsAndChats } from "../data/runtime";

export function ChatOptions({
  serverId,
  chat,
  bots,
}: {
  serverId: string;
  chat: ChatPayload;
  bots: BotPayload[];
}) {
  const client = useHostRuntimeClient(serverId);
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const { pins, toggle: togglePin } = useResourcePins();
  const pin = useMemo(
    () => ({ kind: "chat" as const, serverId, id: chat.id }),
    [serverId, chat.id],
  );
  const pinned = pins.some((p) => pinKey(p) === pinKey(pin));
  const changePin = useCallback(() => togglePin(pin), [togglePin, pin]);
  const requestArchive = useCallback(() => setConfirmArchive(true), []);
  const cancelArchive = useCallback(() => setConfirmArchive(false), []);
  const group = chat.kind === "group" || (!chat.kind && chat.participants.length > 1);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => {
    setVisible(false);
    setConfirmArchive(false);
    setError(null);
  }, []);
  const directBot = !group ? bots.find((bot) => bot.id === chat.participants[0]?.botId) : undefined;
  const configureBot = useCallback(() => {
    if (!directBot?.canConfigure) return;
    close();
    router.push(buildHostBotRoute(serverId, directBot.id));
  }, [directBot, close, router, serverId]);
  const header = useMemo(() => ({ title: "Chat options" }), []);
  const toggleParticipant = useCallback(
    async (botId: string) => {
      if (!client || busy) return;
      setBusy(true);
      setError(null);
      try {
        const exists = chat.participants.some((p) => p.botId === botId);
        if (exists && chat.participants.length === 1)
          throw new Error("A chat needs at least one bot");
        const r = exists
          ? await client.removeChatParticipant({ chatId: chat.id, botId })
          : await client.addChatParticipant({ chatId: chat.id, botId });
        if (r.error) throw new Error(r.error);
        refreshBotsAndChats();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, chat, client],
  );
  const archive = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.archiveChat({ chatId: chat.id });
      if (r.error) throw new Error(r.error);
      refreshBotsAndChats();
      router.replace(buildHostRootRoute(serverId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, chat.id, client, router, serverId]);
  return (
    <>
      <ChatHeaderAction label="Chat options" icon={Ellipsis} onPress={open} />
      <AdaptiveModalSheet visible={visible} header={header} onClose={close}>
        <View style={styles.body}>
          <ConversationProjectActions onChoose={close} />
          <SettingsSection title="Conversation">
            <SettingsCard>
              <SettingsAction
                label="Pinned"
                hint="Keep this chat at the top of the sidebar."
                actionLabel={pinned ? "Unpin" : "Pin chat"}
                onPress={changePin}
              />
              {directBot?.canConfigure ? (
                <SettingsAction
                  label="Bot settings"
                  hint="Configure this bot across its conversations."
                  actionLabel="Open"
                  onPress={configureBot}
                />
              ) : null}
              {!group ? (
                <SettingsRow
                  label={chat.participants[0]?.displayName ?? "Bot"}
                  hint="Direct conversation"
                />
              ) : null}
            </SettingsCard>
          </SettingsSection>
          {group ? (
            <ChatParticipantSettings
              chat={chat}
              bots={bots}
              busy={busy || !client}
              toggle={toggleParticipant}
            />
          ) : null}
          {group ? (
            <SettingsSection title="Replies">
              <SettingsCard>
                <SettingsRow
                  label={
                    chat.rules.interaction?.requireMention
                      ? "Only mentioned bots reply"
                      : "All bots reply unless you @mention one"
                  }
                  hint="Set when this chat was created. Use @mentions to direct your next message."
                />
              </SettingsCard>
            </SettingsSection>
          ) : null}
          <SettingsSection title="Chat history" flush>
            <SettingsCard>
              <SettingsRow
                label="Start a fresh session"
                hint="Send /new in Messages to reset bot context. This chat’s history stays here."
              />
              <SettingsAction
                label="Archive chat"
                hint="Remove this conversation from the active chat list."
                actionLabel="Archive…"
                disabled={busy || !client}
                onPress={requestArchive}
              />
            </SettingsCard>
          </SettingsSection>
          {confirmArchive ? (
            <SettingsCard>
              <SettingsRow
                label="Archive this chat?"
                hint="It will leave the active list. The transcript is kept."
              />
              <Button variant="outline" disabled={busy} onPress={cancelArchive}>
                Cancel
              </Button>
              <Button disabled={busy} onPress={archive}>
                {busy ? "Archiving…" : "Archive chat"}
              </Button>
            </SettingsCard>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {error}
            </Text>
          ) : null}
        </View>
      </AdaptiveModalSheet>
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  text: { color: theme.colors.foreground },
}));

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
import { ChoiceButton } from "../create/choice-button";
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
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
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
          <Text style={styles.text}>Participants</Text>
          {bots.map((bot) => (
            <ChoiceButton
              key={bot.id}
              value={bot.id}
              selected={chat.participants.some((p) => p.botId === bot.id)}
              onSelect={toggleParticipant}
            >
              {bot.name}
            </ChoiceButton>
          ))}
          <Text style={styles.text}>
            Replies:{" "}
            {chat.rules.interaction?.requireMention
              ? "Mentioned bots"
              : "All bots when no one is mentioned"}
          </Text>
          <Text style={styles.text}>Bot-to-bot hop limit: {chat.rules.hops?.max ?? 3}</Text>
          <Text style={styles.text}>
            Type /new to start fresh sessions for the bots in this chat. Your transcript stays here.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {error}
            </Text>
          ) : null}
          <Button variant="outline" disabled={busy} onPress={archive}>
            Archive chat
          </Button>
        </View>
      </AdaptiveModalSheet>
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[3] },
  text: { color: theme.colors.foreground },
}));

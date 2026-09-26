import { ChoiceButton } from "./choice-button";
import { FormTextInput } from "@/components/ui/form-field";
import { useCallback, useState } from "react";
import { View, Text, Switch } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedBot } from "../data/use-bots";
import { refreshBotsAndChats } from "../data/runtime";

export function GroupChatForm({
  bots,
  hosts,
  onCreated,
}: {
  bots: AggregatedBot[];
  hosts: { serverId: string; label: string }[];
  onCreated: (serverId: string, chatId: string) => void;
}) {
  const [serverId, setServerId] = useState(hosts.length === 1 ? hosts[0]!.serverId : "");
  const [ids, setIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [mention, setMention] = useState(false);
  const [hops, setHops] = useState("3");
  const [limit, setLimit] = useState("8000");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const max = Number(hops),
        maxInputCharacters = Number(limit);
      if (
        !Number.isInteger(max) ||
        max < 0 ||
        !Number.isInteger(maxInputCharacters) ||
        maxInputCharacters < 1
      )
        throw new Error("Enter a non-negative hop limit and positive message limit");
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error("Host is disconnected");
      const r = await client.createChat({
        kind: "group",
        botIds: ids,
        title: title.trim() || undefined,
        rules: {
          interaction: { requireMention: mention },
          hops: { max },
          limits: { maxInputCharacters },
        },
      });
      if (r.error || !r.chat) throw new Error(r.error ?? "Could not create chat");
      refreshBotsAndChats();
      onCreated(serverId, r.chat.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [serverId, ids, title, mention, hops, limit, onCreated]);
  const selectHost = useCallback((id: string) => {
    setServerId(id);
    setIds([]);
  }, []);
  const selectBot = useCallback(
    (id: string) =>
      setIds((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      ),
    [],
  );
  const submitAction = useCallback(() => {
    void submit();
  }, [submit]);
  return (
    <View style={styles.form}>
      <FormTextInput
        accessibilityLabel="Chat name"
        style={styles.input}
        initialValue={title}
        onChangeText={setTitle}
        placeholder="Chat name (optional)"
      />
      {hosts.length > 1
        ? hosts.map((host) => (
            <ChoiceButton
              key={host.serverId}
              value={host.serverId}
              selected={serverId === host.serverId}
              onSelect={selectHost}
            >
              {host.label}
            </ChoiceButton>
          ))
        : null}
      {bots
        .filter((bot) => bot.serverId === serverId)
        .map((bot) => (
          <ChoiceButton
            key={bot.id}
            value={bot.id}
            selected={ids.includes(bot.id)}
            onSelect={selectBot}
          >
            {bot.name}
          </ChoiceButton>
        ))}
      <Text style={styles.text}>Reply only when mentioned</Text>
      <Switch accessibilityLabel="Require mention" value={mention} onValueChange={setMention} />
      <Text style={styles.text}>Bot-to-bot hop limit (0 disables forwarding)</Text>
      <FormTextInput
        accessibilityLabel="Hop limit"
        style={styles.input}
        keyboardType="number-pad"
        initialValue={hops}
        onChangeText={setHops}
      />
      <Text style={styles.text}>Maximum message characters</Text>
      <FormTextInput
        accessibilityLabel="Maximum message characters"
        style={styles.input}
        keyboardType="number-pad"
        initialValue={limit}
        onChangeText={setLimit}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {error}
        </Text>
      ) : null}
      <Button disabled={!serverId || ids.length < 2 || busy} onPress={submitAction}>
        {busy ? "Creating…" : "Create group chat"}
      </Button>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
  text: { color: theme.colors.foreground },
  input: {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    borderRadius: 8,
    padding: theme.spacing[3],
  },
}));

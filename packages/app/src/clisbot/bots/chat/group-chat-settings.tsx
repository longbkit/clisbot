import { useFormLifetime } from "../create/use-form-lifetime";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { StyleSheet } from "react-native-unistyles";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { refreshBotsAndChats } from "../data/runtime";
import { groupSettingsPatch, openGroupSettingsDraft } from "./group-settings-model";
const ALL = { label: "All bots unless you @mention one" };
const MENTIONED = { label: "Only bots you @mention" };
const OPTIONS = [
  { id: "all", value: "all", ...ALL },
  { id: "mentioned", value: "mentioned", ...MENTIONED },
];
export function GroupChatSettings({
  serverId,
  chat,
  onSaved,
}: {
  serverId: string;
  chat: ChatPayload;
  onSaved: () => void;
}) {
  const isCurrent = useFormLifetime();
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.chatSettings === true,
  );
  const [original] = useState(() => openGroupSettingsDraft(chat));
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const setTitle = useCallback((title: string) => setDraft((value) => ({ ...value, title })), []);
  const setReply = useCallback(
    (value: string) =>
      setDraft((current) => ({ ...current, requireMention: value === "mentioned" })),
    [],
  );
  const save = useCallback(async () => {
    if (!client || !online || !supported || busy) return;
    setError(null);
    try {
      const patch = groupSettingsPatch(draft, original);
      if (!patch) return;
      setBusy(true);
      const response = await client.updateChat({ chatId: chat.id, patch });
      if (response.error) throw new Error(response.error);
      refreshBotsAndChats();
      if (isCurrent()) onSaved();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [client, online, supported, busy, draft, original, chat.id, onSaved, isCurrent]);
  if (!supported)
    return (
      <View style={styles.fields}>
        <Text style={styles.label}>{chat.title || "Participant names"}</Text>
        <Text style={styles.hint}>
          {chat.rules.interaction?.requireMention ? MENTIONED.label : ALL.label}
        </Text>
        <Text style={styles.hint}>
          This Host does not support editing group settings yet. Update the Host to change the name
          or who replies.
        </Text>
      </View>
    );
  const disabled = busy || !online || Boolean(chat.archivedAt);
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>Group name · optional</Text>
      <FormTextInput
        size={size}
        initialValue={draft.title}
        onChangeText={setTitle}
        maxLength={256}
        editable={!disabled}
        accessibilityLabel="Group name"
        placeholder="Use participant names"
      />
      <SelectField
        label="Who replies?"
        value={draft.requireMention ? "mentioned" : "all"}
        selectedDisplay={draft.requireMention ? MENTIONED : ALL}
        options={OPTIONS}
        onChange={setReply}
        disabled={disabled}
        placeholder="Choose who replies"
        emptyText="No reply options"
        size={size}
      />
      <Text style={styles.hint}>Applies to new messages. Current replies continue.</Text>
      {!online ? <Text style={styles.hint}>Connect to this Host to save changes.</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button
        size={size}
        disabled={
          disabled ||
          (draft.title.trim() === original.title.trim() &&
            draft.requireMention === original.requireMention)
        }
        onPress={save}
      >
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[3] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));

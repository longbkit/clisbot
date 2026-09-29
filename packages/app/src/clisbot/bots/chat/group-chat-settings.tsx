import { Text, View } from "react-native";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { RoomInstructionsField } from "./room-instructions-field";
import { RoundsField } from "./rounds-field";
import { useGroupSettingsForm } from "./use-group-settings-form";
const ALL = { label: "Everyone, one at a time, unless you @mention a bot" };
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
  const form = useGroupSettingsForm(serverId, chat, onSaved);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  if (!form.supported) return <UnsupportedGroupSettings chat={chat} />;
  const { draft, online, busy, error } = form;
  const disabled = busy || !online || Boolean(chat.archivedAt);
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>Group name · optional</Text>
      <FormTextInput
        size={size}
        initialValue={draft.title}
        onChangeText={form.setTitle}
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
        onChange={form.setReply}
        disabled={disabled}
        placeholder="Choose who replies"
        emptyText="No reply options"
        size={size}
      />
      <RoundsField
        value={draft.roundsMax}
        onChange={form.setRoundsMax}
        disabled={disabled}
        size={size}
      />
      <RoomInstructionsField
        initialValue={draft.roomInstructions}
        onChangeText={form.setRoomInstructions}
        editable={!disabled}
      />
      <Text style={styles.hint}>Applies to new messages. Current replies continue.</Text>
      {!online ? <Text style={styles.hint}>Connect to this Host to save changes.</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button size={size} disabled={disabled || !form.changed} onPress={form.save}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </View>
  );
}

/** A Host without the `bots` feature: show the settings, explain why they are read-only. */
function UnsupportedGroupSettings({ chat }: { chat: ChatPayload }) {
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>{chat.title || "Participant names"}</Text>
      <Text style={styles.hint}>
        {chat.rules.interaction?.requireMention ? MENTIONED.label : ALL.label}
      </Text>
      <Text style={styles.hint}>
        This Host does not support editing group settings yet. Update the Host to change the name or
        who replies.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[3] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));

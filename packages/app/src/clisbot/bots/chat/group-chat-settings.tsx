import { Text, View } from "react-native";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { RoomInstructionsField } from "./room-instructions-field";
import { RoundsField } from "./rounds-field";
import { useGroupSettingsForm } from "./use-group-settings-form";
function replyChoices(t: TFunction) {
  const all = { label: t("bots.chat.group.replyAll") };
  const mentioned = { label: t("bots.chat.group.replyMentioned") };
  const options = [
    { id: "all", value: "all", ...all },
    { id: "mentioned", value: "mentioned", ...mentioned },
  ];
  return { all, mentioned, options };
}
export function GroupChatSettings({
  serverId,
  chat,
  onSaved,
}: {
  serverId: string;
  chat: ChatPayload;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const form = useGroupSettingsForm(serverId, chat, onSaved);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  if (!form.supported) return <UnsupportedGroupSettings chat={chat} />;
  const { draft, online, busy, error } = form;
  const disabled = busy || !online || Boolean(chat.archivedAt);
  const reply = replyChoices(t);
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>{t("bots.chat.group.nameLabel")}</Text>
      <FormTextInput
        size={size}
        initialValue={draft.title}
        onChangeText={form.setTitle}
        maxLength={256}
        editable={!disabled}
        accessibilityLabel={t("bots.chat.group.name")}
        placeholder={t("bots.chat.group.namePlaceholder")}
      />
      <SelectField
        label={t("bots.chat.group.whoReplies")}
        value={draft.requireMention ? "mentioned" : "all"}
        selectedDisplay={draft.requireMention ? reply.mentioned : reply.all}
        options={reply.options}
        onChange={form.setReply}
        disabled={disabled}
        placeholder={t("bots.chat.group.chooseWhoReplies")}
        emptyText={t("bots.chat.group.noReplyOptions")}
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
      <Text style={styles.hint}>{t("bots.chat.group.appliesToNew")}</Text>
      {!online ? <Text style={styles.hint}>{t("bots.chat.group.connectToSave")}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button size={size} disabled={disabled || !form.changed} onPress={form.save}>
        {busy ? t("bots.chat.group.saving") : t("bots.chat.group.save")}
      </Button>
    </View>
  );
}

/** A Host without the `bots` feature: show the settings, explain why they are read-only. */
function UnsupportedGroupSettings({ chat }: { chat: ChatPayload }) {
  const { t } = useTranslation();
  const reply = replyChoices(t);
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>{chat.title || t("bots.chat.group.participantNames")}</Text>
      <Text style={styles.hint}>
        {chat.rules.interaction?.requireMention ? reply.mentioned.label : reply.all.label}
      </Text>
      <Text style={styles.hint}>{t("bots.chat.group.unsupported")}</Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[3] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));

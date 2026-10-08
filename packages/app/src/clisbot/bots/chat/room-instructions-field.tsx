import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { CHAT_ROOM_INSTRUCTIONS_MAX_CHARS } from "@clisbot/protocol/chats/rpc-schemas";
import { DEFAULT_ROOM_INSTRUCTIONS } from "@clisbot/protocol/chats/room";
import { FormTextInput } from "@/components/ui/form-field";

/**
 * The part of every group bot's system prompt the chat owner writes
 * (docs/features/bots-and-chats/plans/group-discussion.md). Empty keeps the built-in default,
 * which the placeholder shows.
 */
export function RoomInstructionsField({
  initialValue,
  onChangeText,
  editable,
}: {
  initialValue: string;
  onChangeText: (value: string) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{t("bots.chat.room.label")}</Text>
      <FormTextInput
        initialValue={initialValue}
        onChangeText={onChangeText}
        multiline
        maxLength={CHAT_ROOM_INSTRUCTIONS_MAX_CHARS}
        editable={editable}
        accessibilityLabel={t("bots.chat.room.name")}
        placeholder={DEFAULT_ROOM_INSTRUCTIONS}
      />
      <Text style={styles.hint}>{t("bots.chat.room.hint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

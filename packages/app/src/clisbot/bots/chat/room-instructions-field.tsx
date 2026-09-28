import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CHAT_ROOM_INSTRUCTIONS_MAX_CHARS } from "@getpaseo/protocol/chats/rpc-schemas";
import { DEFAULT_ROOM_INSTRUCTIONS } from "@getpaseo/protocol/chats/room";
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Room instructions · optional</Text>
      <FormTextInput
        initialValue={initialValue}
        onChangeText={onChangeText}
        multiline
        maxLength={CHAT_ROOM_INSTRUCTIONS_MAX_CHARS}
        editable={editable}
        accessibilityLabel="Room instructions"
        placeholder={DEFAULT_ROOM_INSTRUCTIONS}
      />
      <Text style={styles.hint}>
        Every bot in this group reads these with the member list and the room rules. Leave empty to
        use the default shown above.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

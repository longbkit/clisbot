import { Text } from "react-native";
import { FormTextInput } from "@/components/ui/form-field";
import { botFormStyles as styles } from "./bot-form-styles";
import type { BotFormModel, BotFormState } from "./bot-form-model";

/** Longest description the form accepts; the room contract repeats it for every group member. */
export const BOT_DESCRIPTION_MAX_CHARS = 280;

/**
 * The bot's role. In a group chat every bot reads it in the member list to decide when to tag
 * this one (docs/features/bots-and-chats/plans/group-discussion.md).
 */
export function BotDescriptionField({
  state,
  model,
  size,
}: {
  state: BotFormState;
  model: BotFormModel;
  size: "sm" | "md";
}) {
  return (
    <>
      <Text style={styles.text}>Role · optional</Text>
      <FormTextInput
        accessibilityLabel="Bot role"
        size={size}
        initialValue={state.description}
        onChangeText={model.setDescription}
        maxLength={BOT_DESCRIPTION_MAX_CHARS}
        placeholder="For example, Owns product scope and priorities"
      />
      <Text style={styles.hint}>
        {state.description.trim()
          ? "Other bots in a group read this to decide when to tag this bot."
          : "Add a role so other bots in a group know when to tag this bot. Without one they only know its name."}
      </Text>
    </>
  );
}

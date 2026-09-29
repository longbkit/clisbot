import { Field, FormTextInput } from "@/components/ui/form-field";
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
    <Field
      label="Role"
      hint={
        state.description.trim()
          ? "Other bots in a group read this to decide when to tag this bot."
          : "Optional. Add one so other bots in a group know when to tag this bot; without it they only know its name."
      }
    >
      <FormTextInput
        accessibilityLabel="Bot role"
        size={size}
        initialValue={state.description}
        onChangeText={model.setDescription}
        maxLength={BOT_DESCRIPTION_MAX_CHARS}
        placeholder="For example, Owns product scope and priorities"
      />
    </Field>
  );
}

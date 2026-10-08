import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <Field
      label={t("bots.workspace.botForm.role")}
      hint={
        state.description.trim()
          ? t("bots.workspace.botForm.roleHint")
          : t("bots.workspace.botForm.roleHintEmpty")
      }
    >
      <FormTextInput
        accessibilityLabel={t("bots.workspace.botForm.roleLabel")}
        size={size}
        initialValue={state.description}
        onChangeText={model.setDescription}
        maxLength={BOT_DESCRIPTION_MAX_CHARS}
        placeholder={t("bots.workspace.botForm.rolePlaceholder")}
      />
    </Field>
  );
}

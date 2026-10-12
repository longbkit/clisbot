import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatToolDisplaySchema, type ChatToolDisplay } from "@clisbot/protocol/chats/tool-display";
import { SelectField } from "@/components/ui/select-field";

/**
 * How a conversation shows tool calls (`ChatToolDisplay`): Bot settings set it for the Bot's
 * direct chat, Group settings for the group. Errors stay visible in every choice.
 */
export function ToolCallDisplayField({
  value,
  onChange,
  disabled = false,
  size,
}: {
  value: ChatToolDisplay;
  onChange: (value: ChatToolDisplay) => void;
  disabled?: boolean;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      ChatToolDisplaySchema.options.map((choice) => ({
        id: choice,
        value: choice,
        label: t(`bots.chat.toolActivity.${choice}`),
      })),
    [t],
  );
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <SelectField
      label={t("bots.chat.toolActivity.label")}
      value={value}
      selectedDisplay={selected}
      options={options}
      onChange={onChange}
      disabled={disabled}
      placeholder={t("bots.chat.toolActivity.choose")}
      emptyText={t("bots.chat.toolActivity.choose")}
      hint={t("bots.chat.toolActivity.hint")}
      size={size}
      testID="tool-call-display-field"
    />
  );
}

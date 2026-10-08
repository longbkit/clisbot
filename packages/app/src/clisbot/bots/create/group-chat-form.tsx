import { useMemo } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { BotMembersField } from "../chat/bot-members-field";
import { BotFormLayout } from "./form-layout";
import { useGroupChatForm, type GroupChatFormProps } from "./use-group-chat-form";

type Form = ReturnType<typeof useGroupChatForm>;

/**
 * New group chat: three fields of equal rank under the sheet title. Members opens its search
 * first; one bot is enough, for keeping separate topics with the same bot apart.
 */
export function GroupChatForm({ bots, hosts, onCreated }: GroupChatFormProps) {
  const form = useGroupChatForm({ bots, hosts, onCreated });
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const canCreate =
    hosts.some((host) => host.serverId === form.draft.serverId) &&
    form.members.length > 0 &&
    !form.busy;
  const footer = useMemo(
    () => (
      <Button size={size} variant="default" disabled={!canCreate} onPress={form.submit}>
        {form.busy
          ? t("bots.workspace.groupChatForm.creating")
          : t("bots.workspace.shared.createGroupChat")}
      </Button>
    ),
    [size, canCreate, form.submit, form.busy, t],
  );
  return (
    <BotFormLayout footer={footer}>
      <HostField hosts={hosts} form={form} size={size} />
      <BotMembersField
        key={form.draft.serverId}
        members={form.members}
        available={form.available}
        onAdd={form.selectBot}
        onRemove={form.selectBot}
        autoOpen={form.draft.serverId !== ""}
        size={size}
      />
      <Field
        label={t("bots.workspace.groupChatForm.groupName")}
        hint={t("bots.workspace.groupChatForm.groupNameHint")}
      >
        <FormTextInput
          size={size}
          accessibilityLabel={t("bots.workspace.groupChatForm.groupName")}
          initialValue={form.draft.title}
          onChangeText={form.setTitle}
          placeholder={t("bots.workspace.groupChatForm.groupNamePlaceholder")}
        />
      </Field>
      <ReplyField form={form} size={size} />
      {form.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {form.error}
        </Text>
      ) : null}
    </BotFormLayout>
  );
}

function ReplyField({ form, size }: { form: Form; size: "sm" | "md" }) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { id: "all", value: "all", label: t("bots.workspace.groupChatForm.replyAll") },
      {
        id: "mentioned",
        value: "mentioned",
        label: t("bots.workspace.groupChatForm.replyMentioned"),
      },
    ],
    [t],
  );
  const selected = form.draft.requireMention ? options[1]! : options[0]!;
  return (
    <SelectField
      label={t("bots.workspace.groupChatForm.whoReplies")}
      value={selected.value}
      selectedDisplay={selected}
      options={options}
      onChange={form.setReply}
      placeholder={t("bots.workspace.groupChatForm.chooseWhoReplies")}
      emptyText={t("bots.workspace.groupChatForm.noReplyOptions")}
      size={size}
    />
  );
}

/** Only when there is a Host to choose: every bot in a group runs on the same Host. */
function HostField({
  hosts,
  form,
  size,
}: {
  hosts: GroupChatFormProps["hosts"];
  form: Form;
  size: "sm" | "md";
}) {
  const options = useMemo(
    () => hosts.map((host) => ({ id: host.serverId, value: host.serverId, label: host.label })),
    [hosts],
  );
  const selected = hosts.find((host) => host.serverId === form.draft.serverId) ?? null;
  const { t } = useTranslation();
  if (hosts.length === 1 && hosts[0]?.serverId === form.draft.serverId) return null;
  return (
    <SelectField
      label={t("bots.workspace.shared.form.host")}
      value={form.draft.serverId}
      selectedDisplay={selected}
      options={options}
      onChange={form.selectHost}
      placeholder={t("bots.workspace.botForm.chooseHost")}
      emptyText={t("bots.workspace.botForm.noHosts")}
      hint={
        form.draft.botIds.length > 0 ? t("bots.workspace.groupChatForm.hostChangeHint") : undefined
      }
      size={size}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { color: theme.colors.foreground },
}));

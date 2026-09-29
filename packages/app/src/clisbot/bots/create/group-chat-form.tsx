import { useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { BotMembersField } from "../chat/bot-members-field";
import { BotFormLayout } from "./form-layout";
import { useGroupChatForm, type GroupChatFormProps } from "./use-group-chat-form";

const ALL_REPLY = { label: "Everyone, one at a time, unless you @mention a bot" };
const MENTION_REPLY = { label: "Only bots you @mention" };
const REPLY_OPTIONS = [
  { id: "all", value: "all", ...ALL_REPLY },
  { id: "mentioned", value: "mentioned", ...MENTION_REPLY },
];

type Form = ReturnType<typeof useGroupChatForm>;

/**
 * New group chat: three fields of equal rank under the sheet title. Members opens its search
 * first; one bot is enough, for keeping separate topics with the same bot apart.
 */
export function GroupChatForm({ bots, hosts, onCreated }: GroupChatFormProps) {
  const form = useGroupChatForm({ bots, hosts, onCreated });
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const canCreate =
    hosts.some((host) => host.serverId === form.draft.serverId) &&
    form.members.length > 0 &&
    !form.busy;
  const footer = useMemo(
    () => (
      <Button size={size} disabled={!canCreate} onPress={form.submit}>
        {form.busy ? "Creating…" : "Create group chat"}
      </Button>
    ),
    [size, canCreate, form.submit, form.busy],
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
      <Field label="Group name" hint="Optional. Without one, the group shows its members' names.">
        <FormTextInput
          size={size}
          accessibilityLabel="Group name"
          initialValue={form.draft.title}
          onChangeText={form.setTitle}
          placeholder="For example, Product launch"
        />
      </Field>
      <SelectField
        label="Who replies?"
        value={form.draft.requireMention ? "mentioned" : "all"}
        selectedDisplay={form.draft.requireMention ? MENTION_REPLY : ALL_REPLY}
        options={REPLY_OPTIONS}
        onChange={form.setReply}
        placeholder="Choose who replies"
        emptyText="No reply options"
        size={size}
      />
      {form.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {form.error}
        </Text>
      ) : null}
    </BotFormLayout>
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
  if (hosts.length === 1 && hosts[0]?.serverId === form.draft.serverId) return null;
  return (
    <SelectField
      label="Host"
      value={form.draft.serverId}
      selectedDisplay={selected}
      options={options}
      onChange={form.selectHost}
      placeholder="Choose a Host"
      emptyText="No eligible Hosts connected"
      hint={form.draft.botIds.length > 0 ? "Changing Host clears the selected bots." : undefined}
      size={size}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { color: theme.colors.foreground },
}));

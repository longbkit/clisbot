import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { BotMemberPicker } from "../chat/bot-member-picker";
import { BotFormLayout } from "./form-layout";
import { useGroupChatForm, type GroupChatFormProps } from "./use-group-chat-form";

const ALL_REPLY = { label: "Everyone, one at a time, unless you @mention a bot" };
const MENTION_REPLY = { label: "Only bots you @mention" };
const REPLY_OPTIONS = [
  { id: "all", value: "all", ...ALL_REPLY },
  { id: "mentioned", value: "mentioned", ...MENTION_REPLY },
];
/** A group is two or more bots; one bot is a direct chat. */
const MIN_MEMBERS = 2;

type Form = ReturnType<typeof useGroupChatForm>;

/** New group chat: pick the members first, then name the room and say who replies. */
export function GroupChatForm({ bots, hosts, onCreated }: GroupChatFormProps) {
  const form = useGroupChatForm({ bots, hosts, onCreated });
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const chosen = form.draft.botIds.filter((id) => form.hostBots.some((bot) => bot.id === id));
  const canCreate =
    hosts.some((host) => host.serverId === form.draft.serverId) &&
    chosen.length >= MIN_MEMBERS &&
    !form.busy;
  const footer = useMemo(
    () => (
      <Button size={size} disabled={!canCreate} onPress={form.submit}>
        {form.busy ? "Creating…" : createLabel(chosen.length)}
      </Button>
    ),
    [size, canCreate, form.submit, form.busy, chosen.length],
  );
  return (
    <BotFormLayout footer={footer}>
      <HostField hosts={hosts} form={form} size={size} />
      <MembersSection form={form} chosenCount={chosen.length} size={size} />
      <SettingsSection title="Details" flush>
        <View style={styles.fields}>
          <Field
            label="Group name"
            hint="Optional. Without one, the group shows its members' names."
          >
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
        </View>
      </SettingsSection>
      {form.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {form.error}
        </Text>
      ) : null}
    </BotFormLayout>
  );
}

function createLabel(count: number): string {
  if (count < MIN_MEMBERS) return `Choose at least ${MIN_MEMBERS} bots`;
  return `Create group with ${count} bots`;
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

function MembersSection({
  form,
  chosenCount,
  size,
}: {
  form: Form;
  chosenCount: number;
  size: "sm" | "md";
}) {
  const selected = useMemo(() => new Set(form.draft.botIds), [form.draft.botIds]);
  const count = useMemo(
    () => <Text style={styles.hint}>{`${chosenCount} selected`}</Text>,
    [chosenCount],
  );
  return (
    <SettingsSection
      title="Members"
      info="Bots read each other's roles to decide who should answer, so pick bots with distinct roles."
      trailing={count}
    >
      <FormTextInput
        key={form.draft.serverId}
        size={size}
        accessibilityLabel="Search bots"
        initialValue={form.draft.search}
        onChangeText={form.setSearch}
        placeholder="Search by name or role"
      />
      {form.visible.length > 0 ? (
        <BotMemberPicker bots={form.visible} selected={selected} onToggle={form.selectBot} />
      ) : null}
      {form.visible.length === 0 && form.draft.serverId ? (
        <Text style={styles.hint}>No bots match your search.</Text>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[3] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.foreground },
}));

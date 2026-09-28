import { useMemo } from "react";
import { BotFormLayout } from "./form-layout";
import { useCallback } from "react";
import { SettingsCard, SettingsSwitch } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useGroupChatForm, type GroupChatFormProps } from "./use-group-chat-form";
const ALL_REPLY = { label: "All bots unless you @mention one" };
const MENTION_REPLY = { label: "Only bots you @mention" };
export function GroupChatForm({ bots, hosts, onCreated }: GroupChatFormProps) {
  const {
    draft,
    hostBots,
    visible,
    error,
    busy,
    selectHost,
    selectBot,
    setTitle,
    setSearch,
    setReply,
    submit,
  } = useGroupChatForm({ bots, hosts, onCreated });
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const footer = useMemo(
    () => (
      <Button
        size={size}
        disabled={
          !hosts.some((host) => host.serverId === draft.serverId) ||
          draft.botIds.filter((id) => hostBots.some((bot) => bot.id === id)).length < 2 ||
          busy
        }
        onPress={submit}
      >
        {busy ? "Creating…" : "Create group chat"}
      </Button>
    ),
    [size, hosts, draft.serverId, draft.botIds, hostBots, busy, submit],
  );
  return (
    <BotFormLayout footer={footer}>
      <GroupBotPicker
        hosts={hosts}
        draft={draft}
        visible={visible}
        size={size}
        selectHost={selectHost}
        selectBot={selectBot}
        setSearch={setSearch}
      />
      <Text style={styles.label}>Group name · optional</Text>
      <FormTextInput
        size={size}
        accessibilityLabel="Chat name"
        initialValue={draft.title}
        onChangeText={setTitle}
        placeholder="For example, Product launch"
      />
      <SelectField
        label="Who replies?"
        value={draft.requireMention ? "mentioned" : "all"}
        selectedDisplay={draft.requireMention ? MENTION_REPLY : ALL_REPLY}
        options={[
          {
            id: "all",
            value: "all",
            label: "All bots unless you @mention one",
          },
          {
            id: "mentioned",
            value: "mentioned",
            label: "Only bots you @mention",
          },
        ]}
        onChange={setReply}
        placeholder="Choose who replies"
        emptyText="No reply options"
        size={size}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.label}>
          {error}
        </Text>
      ) : null}
    </BotFormLayout>
  );
}
function GroupBotPicker({
  hosts,
  draft,
  visible,
  size,
  selectHost,
  selectBot,
  setSearch,
}: Pick<
  ReturnType<typeof useGroupChatForm>,
  "draft" | "visible" | "selectHost" | "selectBot" | "setSearch"
> & { hosts: GroupChatFormProps["hosts"]; size: "sm" | "md" }) {
  return (
    <>
      {hosts.length !== 1 ? (
        <SelectField
          label="Host"
          value={draft.serverId}
          selectedDisplay={hosts.find((host) => host.serverId === draft.serverId) ?? null}
          options={hosts.map((host) => ({
            id: host.serverId,
            value: host.serverId,
            label: host.label,
          }))}
          onChange={selectHost}
          placeholder="Choose a Host"
          emptyText="No eligible Hosts connected"
          size={size}
        />
      ) : null}
      {hosts.length > 1 && draft.botIds.length > 0 ? (
        <Text style={styles.hint}>Changing Host clears the selected bots.</Text>
      ) : null}
      <Text style={styles.label}>
        Choose bots
        {draft.botIds.length ? ` · ${draft.botIds.length} selected` : ""}
      </Text>
      <FormTextInput
        key={draft.serverId}
        size={size}
        accessibilityLabel="Search bots"
        initialValue={draft.search}
        onChangeText={setSearch}
        placeholder="Search bots…"
      />
      <SettingsCard>
        {visible.map((bot) => (
          <GroupParticipant
            key={bot.id}
            id={bot.id}
            name={bot.name}
            selected={draft.botIds.includes(bot.id)}
            select={selectBot}
          />
        ))}
      </SettingsCard>
      {draft.serverId && visible.length === 0 ? (
        <Text style={styles.hint}>No bots match your search.</Text>
      ) : null}
    </>
  );
}
function GroupParticipant({
  id,
  name,
  selected,
  select,
}: {
  id: string;
  name: string;
  selected: boolean;
  select: (id: string) => void;
}) {
  const toggle = useCallback(() => select(id), [id, select]);
  return <SettingsSwitch label={name} value={selected} onValueChange={toggle} />;
}
const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
  label: { color: theme.colors.foreground },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

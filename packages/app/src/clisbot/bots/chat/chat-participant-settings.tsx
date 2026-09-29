import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { FormTextInput } from "@/components/ui/form-field";
import { SettingsSection } from "@/components/settings";
import type { BotPayload } from "../data/contracts";
import { BotMemberPicker, type PickerBot } from "./bot-member-picker";

/**
 * A group's members, with the same picker as New group chat: members first, then the Host's
 * other bots; checking or unchecking one applies at once. The last member cannot be removed.
 */
export function ChatParticipantSettings({
  chat,
  bots,
  busy,
  toggle,
}: {
  chat: ChatPayload;
  bots: BotPayload[];
  busy: boolean;
  toggle: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(chat.participants.map((p) => p.botId)), [chat]);
  const rows = useMemo(() => memberRows(chat, bots, search), [chat, bots, search]);
  const count = useMemo(
    () => <Text style={styles.hint}>{`${selected.size} in this chat`}</Text>,
    [selected.size],
  );
  const onToggle = useCallback((id: string) => void toggle(id), [toggle]);
  const isLocked = useCallback((id: string) => selected.size === 1 && selected.has(id), [selected]);
  return (
    <SettingsSection
      title="Members"
      info="Changes apply immediately. Bots read each other's roles to decide who should answer."
      trailing={count}
    >
      <FormTextInput
        accessibilityLabel="Search bots"
        placeholder="Search by name or role"
        initialValue={search}
        onChangeText={setSearch}
      />
      <BotMemberPicker
        bots={rows}
        selected={selected}
        onToggle={onToggle}
        disabled={busy}
        isLocked={isLocked}
      />
    </SettingsSection>
  );
}

/** Members first, in Members order, then the other bots; both filtered by name or role. */
function memberRows(chat: ChatPayload, bots: readonly BotPayload[], search: string): PickerBot[] {
  const query = search.trim().toLowerCase();
  const matches = (bot: PickerBot) =>
    bot.name.toLowerCase().includes(query) || (bot.description ?? "").toLowerCase().includes(query);
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const members = chat.participants.map(
    (p): PickerBot => byId.get(p.botId) ?? { id: p.botId, name: p.displayName },
  );
  const memberIds = new Set(members.map((bot) => bot.id));
  const others = bots.filter((bot) => !memberIds.has(bot.id));
  return [...members, ...others].filter(matches);
}

const styles = StyleSheet.create((theme) => ({
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

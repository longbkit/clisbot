import { useCallback, useState } from "react";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { FormTextInput } from "@/components/ui/form-field";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings";
import type { BotPayload } from "../data/contracts";

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
  const selected = new Set(chat.participants.map((p) => p.botId));
  const available = bots.filter(
    (bot) => !selected.has(bot.id) && bot.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <SettingsSection title={`Participants · ${chat.participants.length}`}>
        <SettingsCard>
          {chat.participants.map((p) => (
            <Participant
              key={p.botId}
              id={p.botId}
              name={p.displayName}
              selected
              busy={busy || selected.size === 1}
              toggle={toggle}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Add bots">
        <FormTextInput
          accessibilityLabel="Search bots to add"
          placeholder="Search bots…"
          initialValue={search}
          onChangeText={setSearch}
        />
        <SettingsCard>
          {available.slice(0, 8).map((bot) => (
            <Participant
              key={bot.id}
              id={bot.id}
              name={bot.name}
              selected={false}
              busy={busy}
              toggle={toggle}
            />
          ))}
          {!available.length ? (
            <SettingsRow
              label="No bots to add"
              hint="All matching bots are already in this chat."
            />
          ) : null}
          {available.length > 8 ? <SettingsRow label="Search to find more bots" /> : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
function Participant({
  id,
  name,
  selected,
  busy,
  toggle,
}: {
  id: string;
  name: string;
  selected: boolean;
  busy: boolean;
  toggle: (id: string) => Promise<void>;
}) {
  const change = useCallback(() => {
    void toggle(id);
  }, [id, toggle]);
  return (
    <SettingsSwitch
      label={name}
      hint={selected ? "In this chat" : "Add to this chat"}
      value={selected}
      disabled={busy}
      onValueChange={change}
    />
  );
}

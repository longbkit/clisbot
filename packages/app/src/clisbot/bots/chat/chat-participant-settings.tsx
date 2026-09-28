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
  const roleOf = (botId: string) => bots.find((bot) => bot.id === botId)?.description;
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
              role={roleOf(p.botId)}
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
              role={bot.description}
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
/** Other bots read the role to decide when to tag this one, so a missing role is called out. */
function roleHint(role: string | null | undefined, selected: boolean): string {
  const place = selected ? "In this chat" : "Add to this chat";
  const text = role?.trim();
  return text
    ? `${place} · ${text}`
    : `${place} · No role yet: other bots only know its name. Add one in Bot settings.`;
}

function Participant({
  id,
  name,
  role,
  selected,
  busy,
  toggle,
}: {
  id: string;
  name: string;
  role?: string | null;
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
      hint={roleHint(role, selected)}
      value={selected}
      disabled={busy}
      onValueChange={change}
    />
  );
}

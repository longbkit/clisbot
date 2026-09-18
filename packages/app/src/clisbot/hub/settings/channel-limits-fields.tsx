import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import {
  CHANNEL_LIMIT_NAMES,
  type ChannelAccountLimits,
  type ChannelLimitName,
  type ChannelLimits,
} from "../channel-configuration";

/**
 * Channel limits as a form: each leaf is left at its default, set to a
 * number, or turned off. The same fields serve the Bot, each Conversation and
 * a Route (docs/audits/2026-09-18-channel-chat-authority-and-limits.md).
 */
type LimitMode = "default" | "custom" | "off";
interface LimitDraft {
  mode: LimitMode;
  value: string;
}
export type ChannelLimitsDraft = Record<ChannelLimitName, LimitDraft>;
export type ChannelLimitDefaults = Partial<Record<ChannelLimitName, number>>;

const LIMIT_LABELS: Record<ChannelLimitName, string> = {
  maxInputCharacters: "Maximum input characters",
  messagesPerMinutePerSender: "Messages received per minute, per sender",
  messagesPerMinute: "Messages received per minute",
  messagesSentPerMinute: "Messages sent per minute",
  maxConcurrentRuns: "Concurrent runs",
  maxRuntimeSeconds: "Maximum runtime (seconds)",
};

/** The Bot and Conversation scopes have no defaults: unset means no limit. */
export const NO_DEFAULTS: ChannelLimitDefaults = {};

/**
 * With a default there are three choices; without one, "Default" already means
 * no limit, so the choices are just "No limit" and "Set".
 */
function modeChoices(defaultValue: number | undefined): { mode: LimitMode; label: string }[] {
  if (defaultValue === undefined) {
    return [
      { mode: "default", label: "No limit" },
      { mode: "custom", label: "Set" },
    ];
  }
  return [
    { mode: "default", label: `Default (${String(defaultValue)})` },
    { mode: "custom", label: "Set" },
    { mode: "off", label: "Off" },
  ];
}

export function channelLimitsDraft(authored: unknown): ChannelLimitsDraft {
  const record =
    typeof authored === "object" && authored !== null ? (authored as Record<string, unknown>) : {};
  const entry = (name: ChannelLimitName): LimitDraft => {
    const value = record[name];
    if (value === "off") return { mode: "off", value: "" };
    if (typeof value === "number") return { mode: "custom", value: String(value) };
    return { mode: "default", value: "" };
  };
  return Object.fromEntries(
    CHANNEL_LIMIT_NAMES.map((name) => [name, entry(name)]),
  ) as ChannelLimitsDraft;
}

export function parseChannelLimitsDraft(
  draft: ChannelLimitsDraft,
): { valid: true; value: ChannelLimits } | { valid: false; error: string } {
  const value: ChannelLimits = {};
  for (const name of CHANNEL_LIMIT_NAMES) {
    const { mode, value: text } = draft[name];
    if (mode === "off") value[name] = "off";
    if (mode !== "custom") continue;
    const parsed = Number(text.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { valid: false, error: `${LIMIT_LABELS[name]}: use a positive whole number.` };
    }
    value[name] = parsed;
  }
  return { valid: true, value };
}

/** One line for a card: what is set, or that everything is at its default. */
export function channelLimitsSummary(limits: unknown): string {
  const draft = channelLimitsDraft(limits);
  const set = CHANNEL_LIMIT_NAMES.flatMap((name) => {
    const { mode, value } = draft[name];
    if (mode === "default") return [];
    return [`${LIMIT_LABELS[name]}: ${mode === "off" ? "off" : value}`];
  });
  return set.length === 0 ? "Default limits" : set.join(" · ");
}

export function ChannelLimitsFields({
  draft,
  setDraft,
  defaults,
  error,
  disabled,
}: {
  draft: ChannelLimitsDraft;
  setDraft(update: (current: ChannelLimitsDraft) => ChannelLimitsDraft): void;
  defaults: ChannelLimitDefaults;
  error?: string | null;
  disabled: boolean;
}) {
  const change = useCallback(
    (name: ChannelLimitName, next: LimitDraft) =>
      setDraft((current) => ({ ...current, [name]: next })),
    [setDraft],
  );
  return (
    <View style={styles.fields}>
      {CHANNEL_LIMIT_NAMES.map((name) => (
        <LimitRow
          key={name}
          name={name}
          entry={draft[name]}
          defaultValue={defaults[name]}
          onChange={change}
          disabled={disabled}
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function LimitRow({
  name,
  entry,
  defaultValue,
  onChange,
  disabled,
}: {
  name: ChannelLimitName;
  entry: LimitDraft;
  defaultValue: number | undefined;
  onChange(name: ChannelLimitName, next: LimitDraft): void;
  disabled: boolean;
}) {
  const setValue = useCallback(
    (value: string) => onChange(name, { mode: "custom", value }),
    [name, onChange],
  );
  return (
    <Field label={LIMIT_LABELS[name]}>
      <View style={styles.modes}>
        {modeChoices(defaultValue).map(({ mode, label }) => (
          <ModeButton
            key={mode}
            name={name}
            mode={mode}
            label={label}
            entry={entry}
            defaultValue={defaultValue}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </View>
      {entry.mode === "custom" ? (
        <FormTextInput
          initialValue={entry.value}
          onChangeText={setValue}
          keyboardType="number-pad"
          editable={!disabled}
        />
      ) : null}
    </Field>
  );
}

function ModeButton({
  name,
  mode,
  label,
  entry,
  defaultValue,
  onChange,
  disabled,
}: {
  name: ChannelLimitName;
  mode: LimitMode;
  label: string;
  entry: LimitDraft;
  defaultValue: number | undefined;
  onChange(name: ChannelLimitName, next: LimitDraft): void;
  disabled: boolean;
}) {
  // Choosing "Set" starts from the default when there is one.
  const select = useCallback(
    () =>
      onChange(name, {
        mode,
        value: mode === "custom" && entry.value === "" ? String(defaultValue ?? "") : entry.value,
      }),
    [defaultValue, entry.value, mode, name, onChange],
  );
  return (
    <Button
      size="xs"
      variant={entry.mode === mode ? "secondary" : "outline"}
      disabled={disabled}
      onPress={select}
    >
      {label}
    </Button>
  );
}

/** The Bot's own limits and the limits each of its Conversations gets. */
export function ChannelAccountLimitsPanel({
  limits,
  pending,
  save,
}: {
  limits: unknown;
  pending: boolean;
  save(limits: ChannelAccountLimits | undefined): Promise<void>;
}) {
  const record =
    typeof limits === "object" && limits !== null ? (limits as Record<string, unknown>) : {};
  const [bot, setBot] = useState(() => channelLimitsDraft(record));
  const [conversation, setConversation] = useState(() =>
    channelLimitsDraft(record["perConversation"]),
  );
  const parsedBot = parseChannelLimitsDraft(bot);
  const parsedConversation = parseChannelLimitsDraft(conversation);
  const submit = useCallback(() => {
    if (!parsedBot.valid || !parsedConversation.valid) return;
    const perConversation = parsedConversation.value;
    const next: ChannelAccountLimits = {
      ...parsedBot.value,
      ...(Object.keys(perConversation).length === 0 ? {} : { perConversation }),
    };
    void save(Object.keys(next).length === 0 ? undefined : next);
  }, [parsedBot, parsedConversation, save]);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Whole bot</Text>
        <Text style={settingsStyles.rowHint}>
          Counted across every conversation of this bot. Messages over a rate or run limit wait
          their turn; a message longer than the input limit is refused.
        </Text>
        <ChannelLimitsFields
          draft={bot}
          setDraft={setBot}
          defaults={NO_DEFAULTS}
          error={parsedBot.valid ? null : parsedBot.error}
          disabled={pending}
        />
        <Text style={settingsStyles.rowTitle}>Each conversation</Text>
        <Text style={settingsStyles.rowHint}>
          Counted per channel, group or DM. Every thread of a channel counts toward that channel.
        </Text>
        <ChannelLimitsFields
          draft={conversation}
          setDraft={setConversation}
          defaults={NO_DEFAULTS}
          error={parsedConversation.valid ? null : parsedConversation.error}
          disabled={pending}
        />
        <Button
          size="sm"
          disabled={pending || !parsedBot.valid || !parsedConversation.valid}
          onPress={submit}
        >
          Save limits
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fields: {
    gap: theme.spacing[3],
  },
  modes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));

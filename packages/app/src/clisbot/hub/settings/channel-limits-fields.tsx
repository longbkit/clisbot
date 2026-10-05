import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import {
  CHANNEL_LIMIT_NAMES,
  type ChannelAccountLimits,
  type ChannelLimitName,
} from "../channel-configuration";
import { SettingRow } from "./channel-route-behavior-rows";
import {
  LIMITS_NOTE,
  LIMIT_LABELS,
  LIMIT_UNITS,
  NO_DEFAULTS,
  channelLimitsDraft,
  parseChannelLimitsDraft,
  type ChannelLimitDefaults,
  type ChannelLimitsDraft,
  type LimitDraft,
} from "./channel-limits-draft";

// The fields of the Channel limits form (`channel-limits-draft.ts` holds its
// model). The same fields serve the Bot, each Conversation, a Route and a Rule.

export function ChannelLimitsFields({
  draft,
  setDraft,
  defaults,
  error,
  disabled,
  names = CHANNEL_LIMIT_NAMES,
  note = true,
}: {
  /** The limits this scope carries, in display order. */
  names?: readonly ChannelLimitName[];
  /** The one line saying how limits behave; off where a second set follows the first. */
  note?: boolean;
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
      {note ? <Text style={styles.note}>{LIMITS_NOTE}</Text> : null}
      {names.map((name) => (
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

/**
 * One limit on one line: its name, a short number field, its unit, and Off
 * where there is a default to turn off. An empty field is the default, shown
 * in the field itself, so nothing explains a value that is not there.
 */
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
  const off = entry.mode === "off";
  const type = useCallback(
    (value: string) =>
      onChange(
        name,
        value.trim() === "" ? { mode: "default", value: "" } : { mode: "custom", value },
      ),
    [name, onChange],
  );
  const toggleOff = useCallback(
    () => onChange(name, off ? { mode: "default", value: "" } : { mode: "off", value: "" }),
    [name, off, onChange],
  );
  const label = LIMIT_LABELS[name];
  return (
    <SettingRow label={label}>
      <View style={styles.numberInput}>
        <FormTextInput
          // A fresh field when Turn off clears it, so no stale number shows through.
          key={off ? "off" : "on"}
          initialValue={entry.mode === "custom" ? entry.value : ""}
          onChangeText={type}
          placeholder={placeholder(off, defaultValue)}
          keyboardType="number-pad"
          accessibilityLabel={label}
          editable={!disabled && !off}
        />
      </View>
      {/* Fixed slots for the unit and the action, so every row's field lines up. */}
      <Text style={styles.unit}>{LIMIT_UNITS[name] ?? ""}</Text>
      <View style={styles.offSlot}>
        {defaultValue === undefined && !off ? null : (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onPress={toggleOff}
            accessibilityLabel={`${label}: ${off ? "use default" : "turn off"}`}
          >
            {off ? "Use default" : "Turn off"}
          </Button>
        )}
      </View>
    </SettingRow>
  );
}

function placeholder(off: boolean, defaultValue: number | undefined): string {
  if (off) return "Off";
  return defaultValue === undefined ? "No limit" : `Default ${String(defaultValue)}`;
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
      <View style={[settingsStyles.rowContent, styles.panel]}>
        <Text style={settingsStyles.rowTitle}>Whole bot</Text>
        <Text style={settingsStyles.rowHint}>Every conversation of this bot together.</Text>
        <ChannelLimitsFields
          draft={bot}
          setDraft={setBot}
          defaults={NO_DEFAULTS}
          error={parsedBot.valid ? null : parsedBot.error}
          disabled={pending}
        />
        <Text style={[settingsStyles.rowTitle, styles.group]}>Each conversation</Text>
        <Text style={settingsStyles.rowHint}>
          Each channel, group or DM on its own, its threads included.
        </Text>
        <ChannelLimitsFields
          draft={conversation}
          setDraft={setConversation}
          defaults={NO_DEFAULTS}
          note={false}
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
  panel: { gap: theme.spacing[2] },
  // The second scope starts a new group: set it off from the fields above.
  group: { marginTop: theme.spacing[4] },
  fields: {
    gap: theme.spacing[3],
  },
  // The Route form's number rows (`RouteNumberRow`): a short field, its unit after it.
  numberInput: { width: 128 },
  unit: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, width: 64 },
  offSlot: { alignItems: "flex-end", width: 92 },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));

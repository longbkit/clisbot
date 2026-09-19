import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TargetedEvent,
} from "react-native";
import { X } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import {
  HubObservedChannelConversationsSchema,
  HubObservedChannelSendersSchema,
} from "../contracts";
import {
  observedConversationOptions,
  splitConversationIds,
  type ConversationKind,
  type ConversationOption,
} from "../conversation-picker";

/** The words the id picker uses for what it picks. */
interface IdPickerLabels {
  choose: string;
  search: string;
  empty: string;
  none: string;
  manualField: string;
  manualHint: string;
  unavailable: string;
}

const CONVERSATION_LABELS: IdPickerLabels = {
  choose: "Choose conversations",
  search: "Search by name or provider ID",
  empty: "No conversation matches this search.",
  none: "No conversations selected.",
  manualField: "Conversation IDs",
  manualHint:
    "Enter multiple IDs separated by commas or new lines. These update the selected conversations above.",
  unavailable:
    "Conversation names are unavailable. Your selected IDs are unchanged; you can enter IDs manually.",
};

const SENDER_LABELS: IdPickerLabels = {
  choose: "Choose people who messaged the bot",
  search: "Search by name, username or ID",
  empty: "Nobody outside the Hub matches this search.",
  none: "No senders selected.",
  manualField: "Sender IDs",
  manualHint:
    "Channel user ids, separated by commas or new lines: U0ALICE or slack:U0ALICE. Use this for someone who has not messaged the bot yet.",
  unavailable:
    "The people who messaged this bot are unavailable. Your selected IDs are unchanged; you can enter IDs manually.",
};

/** Reads one per-account directory list (`conversations` or `senders`). */
function useAccountDirectory<Schema extends z.ZodType>(
  read: "conversations" | "senders",
  channel: string | null,
  accountId: string | null,
  schema: Schema,
) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const path =
    channel === null || accountId === null
      ? ""
      : `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}/${read}`;
  return useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(
        { origin: hub.origin, organizationId, accountId: hub.signedIn?.account.id ?? null },
        `channel-${read}`,
      ),
      channel,
      accountId,
    ],
    queryFn: () => hub.api().get(path, schema),
    enabled: organizationId.length > 0 && path.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
}

/** Conversations this bot has seen, plus the ones Routes already name, searchable by name. */
export function ConversationSelectionFields({
  channel,
  accountId,
  kind,
  value,
  onChange,
  disabled,
  hint,
  placeholder,
}: {
  channel: string | null;
  accountId: string | null;
  kind?: ConversationKind;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  hint: string;
  placeholder: string;
}) {
  const observations = useAccountDirectory(
    "conversations",
    channel,
    accountId,
    HubObservedChannelConversationsSchema,
  );
  const options = useMemo(
    () =>
      observedConversationOptions(
        observations.data?.conversations ?? [],
        kind,
        observations.data?.destinations,
      ),
    [kind, observations.data?.conversations, observations.data?.destinations],
  );
  return (
    <IdSelectionFields
      pickerKey={`${channel}:${accountId}:${kind}`}
      options={options}
      labels={CONVERSATION_LABELS}
      loadFailed={Boolean(observations.error)}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint={hint}
      placeholder={placeholder}
    />
  );
}

/** People who messaged this bot and are not linked to a Member: a Route's
 * "senders outside the Hub". Manual ids stay available for someone new. */
export function SenderSelectionFields({
  channel,
  accountId,
  value,
  onChange,
  disabled,
}: {
  channel: string | null;
  accountId: string | null;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  const senders = useAccountDirectory(
    "senders",
    channel,
    accountId,
    HubObservedChannelSendersSchema,
  );
  const options = useMemo<ConversationOption[]>(
    () =>
      (senders.data?.senders ?? []).map((sender) => ({
        id: sender.identity,
        conversationId: sender.identity,
        label: sender.name ?? sender.username ?? sender.id,
        description: [sender.username ? `@${sender.username}` : null, sender.id]
          .filter(Boolean)
          .join(" · "),
      })),
    [senders.data?.senders],
  );
  return (
    <IdSelectionFields
      pickerKey={`${channel}:${accountId}:senders`}
      options={options}
      labels={SENDER_LABELS}
      loadFailed={Boolean(senders.error)}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint="People outside the Hub, picked from those who already messaged this bot."
      placeholder="U0ALICE, U0BOB"
    />
  );
}

/** Selected ids as named rows, a searchable picker over `options`, and manual id entry. */
function IdSelectionFields({
  pickerKey,
  options,
  labels,
  loadFailed,
  value,
  onChange,
  disabled,
  hint,
  placeholder,
}: {
  pickerKey: string;
  options: readonly ConversationOption[];
  labels: IdPickerLabels;
  loadFailed: boolean;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  hint: string;
  placeholder: string;
}) {
  const hub = useHubAccount();
  const [manualEntry, setManualEntry] = useState(false);
  const toggleManualEntry = useCallback(() => setManualEntry((current) => !current), []);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const displayedValue = useRef(value);
  useEffect(() => {
    if (displayedValue.current === value) return;
    displayedValue.current = value;
    inputRef.current?.replaceText(value);
  }, [value]);
  const selectedIds = useMemo(() => splitConversationIds(value), [value]);
  const setSelectedIds = useCallback(
    (ids: readonly string[]) => {
      const next = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].join(", ");
      displayedValue.current = next;
      inputRef.current?.replaceText(next);
      onChange(next);
    },
    [onChange],
  );
  const changeText = useCallback(
    (next: string) => {
      displayedValue.current = next;
      onChange(next);
    },
    [onChange],
  );

  return (
    // The choice above already names this group, so a Field label here would
    // only repeat the selected button's own text.
    <View style={styles.selection}>
      {selectedIds.length === 0 ? (
        <Text style={settingsStyles.rowHint}>{labels.none}</Text>
      ) : (
        selectedIds.map((id) => (
          <SelectedConversation
            key={id}
            id={id}
            option={options.find((option) => option.conversationId === id)}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            disabled={disabled}
          />
        ))
      )}
      <View style={styles.pickerRow}>
        {options.length > 0 ? (
          <ObservedConversationPicker
            key={`${hub.origin}:${hub.signedIn?.account.id}:${hub.signedIn?.organization.id}:${pickerKey}`}
            options={options}
            labels={labels}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            disabled={disabled}
          />
        ) : null}
        <Button size="sm" variant="outline" onPress={toggleManualEntry} disabled={disabled}>
          {manualEntry ? "Hide ID entry" : "Enter IDs"}
        </Button>
      </View>
      {manualEntry ? (
        <Field label={labels.manualField} hint={labels.manualHint}>
          <FormTextInput
            ref={inputRef}
            initialValue={value}
            onChangeText={changeText}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            multiline
          />
        </Field>
      ) : null}
      {loadFailed ? <Text style={settingsStyles.rowHint}>{labels.unavailable}</Text> : null}
      <Text style={settingsStyles.rowHint}>{hint}</Text>
    </View>
  );
}

function SelectedConversation({
  id,
  option,
  selectedIds,
  onChange,
  disabled,
}: {
  id: string;
  option: ConversationOption | undefined;
  selectedIds: readonly string[];
  onChange(ids: readonly string[]): void;
  disabled: boolean;
}) {
  const remove = useCallback(
    () => onChange(selectedIds.filter((selected) => selected !== id)),
    [id, onChange, selectedIds],
  );
  return (
    <View style={styles.selectedRow}>
      <View style={styles.selectedText}>
        <Text selectable style={settingsStyles.rowTitle}>
          {option?.label ?? id}
        </Text>
        {option ? (
          <Text selectable style={styles.selectedMeta}>
            {option.description}
          </Text>
        ) : null}
      </View>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={X}
        accessibilityLabel={`Remove ${option?.label ?? id}`}
        disabled={disabled}
        onPress={remove}
      />
    </View>
  );
}

function ObservedConversationPicker({
  options,
  labels,
  selectedIds,
  onChange,
  disabled,
}: {
  options: readonly ConversationOption[];
  labels: IdPickerLabels;
  selectedIds: readonly string[];
  onChange(ids: readonly string[]): void;
  disabled: boolean;
}) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const pickerActions = useMemo(
    () => (
      <View style={styles.pickerActions}>
        <Button size="sm" variant="secondary" onPress={close}>
          Done
        </Button>
      </View>
    ),
    [close],
  );
  const [focused, setFocused] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggle = useCallback(
    (optionId: string) => {
      const option = options.find(({ id }) => id === optionId);
      if (option === undefined) return;
      onChange(
        selected.has(option.conversationId)
          ? selectedIds.filter((id) => id !== option.conversationId)
          : [...selectedIds, option.conversationId],
      );
    },
    [onChange, options, selected, selectedIds],
  );
  const onFocus = useCallback((_event: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(true);
  }, []);
  const onBlur = useCallback((_event: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(false);
  }, []);
  const toggleOpen = useCallback(() => {
    setOpen((current) => !current);
  }, []);
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, active, onPress }) => {
      const item = options.find(({ id }) => id === option.id)!;
      return (
        <ComboboxItem
          label={item.label}
          description={item.description}
          selected={selected.has(item.conversationId)}
          active={active}
          onPress={onPress}
        />
      );
    },
    [options, selected],
  );

  return (
    <View style={styles.pickerTrigger}>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          disabled={disabled}
          onPress={toggleOpen}
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityRole="button"
          accessibilityLabel={labels.choose}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              label={labels.choose}
              isPlaceholder={false}
              placeholder={labels.choose}
              hovered={Boolean(hovered)}
              focused={focused}
              active={pressed || open}
              disabled={disabled}
            />
          )}
        </Pressable>
      </View>
      <Combobox
        options={[...options]}
        value=""
        onSelect={toggle}
        searchable
        searchPlaceholder={labels.search}
        emptyText={labels.empty}
        title={labels.choose}
        stickyHeader={pickerActions}
        open={open}
        onOpenChange={setOpen}
        keepOpenOnSelect
        anchorRef={anchorRef}
        renderOption={renderOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  selection: { gap: theme.spacing[2] },
  pickerActions: {
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[2],
  },
  pickerRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  pickerTrigger: {
    flexBasis: 200,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  selectedRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  selectedText: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  selectedMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

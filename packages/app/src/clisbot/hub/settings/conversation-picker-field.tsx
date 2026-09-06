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
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { HubObservedChannelConversationsSchema } from "../contracts";
import {
  observedConversationOptions,
  splitConversationIds,
  type ConversationKind,
  type ConversationOption,
} from "../conversation-picker";

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
  channel: "slack" | "telegram" | null;
  accountId: string | null;
  kind?: ConversationKind;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  hint: string;
  placeholder: string;
}) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const observations = useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(
        { origin: hub.origin, organizationId, accountId: hub.signedIn?.account.id ?? null },
        "channel-conversations",
      ),
      channel,
      accountId,
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `channel-accounts/${encodeURIComponent(channel!)}/${encodeURIComponent(accountId!)}/conversations`,
          HubObservedChannelConversationsSchema,
        ),
    enabled: organizationId.length > 0 && channel !== null && accountId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
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
  const options = useMemo(
    () =>
      observedConversationOptions(
        observations.data?.conversations ?? [],
        kind,
        observations.data?.destinations,
      ),
    [kind, observations.data?.conversations, observations.data?.destinations],
  );
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
    <Field label="Selected conversations" hint={hint}>
      <View style={styles.selection}>
        {selectedIds.length === 0 ? (
          <Text style={settingsStyles.rowHint}>No conversations selected.</Text>
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
        {options.length > 0 ? (
          <ObservedConversationPicker
            key={`${hub.origin}:${hub.signedIn?.account.id}:${organizationId}:${channel}:${accountId}:${kind}`}
            options={options}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            disabled={disabled}
          />
        ) : null}
        <Button size="xs" variant="outline" onPress={toggleManualEntry} disabled={disabled}>
          {manualEntry ? "Hide ID entry" : "Enter IDs"}
        </Button>
        {manualEntry ? (
          <Field
            label="Conversation IDs"
            hint="Enter multiple IDs separated by commas or new lines. These update the selected conversations above."
          >
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
        {observations.error ? (
          <Text style={settingsStyles.rowHint}>
            Conversation names are unavailable. Your selected IDs are unchanged; you can enter IDs
            manually.
          </Text>
        ) : null}
      </View>
    </Field>
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
          <Text selectable style={settingsStyles.rowHint}>
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
  selectedIds,
  onChange,
  disabled,
}: {
  options: readonly ConversationOption[];
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
    <View style={styles.selection}>
      <Text style={settingsStyles.rowHint}>Choose one or more known conversations.</Text>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          disabled={disabled}
          onPress={toggleOpen}
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityRole="button"
          accessibilityLabel="Choose conversations"
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              label="Choose conversations"
              isPlaceholder={false}
              placeholder="Choose conversations"
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
        searchPlaceholder="Search by name or provider ID"
        emptyText="No conversation matches this search."
        title="Choose conversations"
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
  selectedRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  selectedText: { flex: 1, minWidth: 0 },
}));

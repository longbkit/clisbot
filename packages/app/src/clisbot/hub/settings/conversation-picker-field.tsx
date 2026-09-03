import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TargetedEvent,
} from "react-native";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubObservedChannelConversationsSchema } from "../contracts";
import {
  observedConversationOptions,
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
      "clisbot",
      "hub",
      hub.origin,
      organizationId,
      "channel-conversations",
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
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const inputRef = useRef<EditingTextInputHandle>(null);
  const displayedValue = useRef(value);
  useEffect(() => {
    if (displayedValue.current === value) return;
    displayedValue.current = value;
    inputRef.current?.replaceText(value);
  }, [value]);
  const selectedIds = useMemo(() => splitConversationIds(value), [value]);
  const options = useMemo(
    () => observedConversationOptions(observations.data?.conversations ?? [], kind),
    [kind, observations.data?.conversations],
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
    <>
      {options.length > 0 ? (
        <ObservedConversationPicker
          options={options}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          disabled={disabled}
        />
      ) : null}
      <Field label="Conversation IDs" hint={hint}>
        <FormTextInput
          ref={inputRef}
          initialValue={value}
          onChangeText={changeText}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
        />
      </Field>
      {observations.error ? (
        <Text style={settingsStyles.rowHint}>
          Observed Conversations are unavailable. Enter an exact provider ID instead.
        </Text>
      ) : null}
    </>
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
  const [focused, setFocused] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedObservedCount = options.filter((option) =>
    selected.has(option.conversationId),
  ).length;
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
    <Field
      label="Observed conversations"
      hint="Select known Conversations, or enter an exact provider ID below."
    >
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          disabled={disabled}
          onPress={toggleOpen}
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityRole="button"
          accessibilityLabel={`Observed conversations (${String(selectedObservedCount)} selected)`}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              label={
                selectedObservedCount === 0
                  ? "Choose observed Conversations"
                  : `${String(selectedObservedCount)} selected`
              }
              isPlaceholder={selectedObservedCount === 0}
              placeholder="Choose observed Conversations"
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
        emptyText="No observed Conversation matches this search."
        title="Observed conversations"
        open={open}
        onOpenChange={setOpen}
        keepOpenOnSelect
        anchorRef={anchorRef}
        renderOption={renderOption}
      />
    </Field>
  );
}

function splitConversationIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

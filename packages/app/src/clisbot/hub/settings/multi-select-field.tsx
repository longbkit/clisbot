import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TargetedEvent,
} from "react-native";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Field } from "@/components/ui/form-field";
import { SelectFieldTrigger, type SelectFieldOption } from "@/components/ui/select-field";

/**
 * A choice that either names every current and future option, or lists exact
 * ids. `"*"` is stored, not expanded, so an option added later stays covered.
 */
export type MultiSelection = "*" | readonly string[];

const ALL_OPTION_ID = "*";

/** One line naming a selection, for triggers and collapsed summaries. */
export function selectionLabel(
  value: MultiSelection | null,
  options: readonly SelectFieldOption<string>[],
  allLabel: string | undefined,
): string | null {
  if (value === null) return null;
  if (value === "*") return allLabel ?? null;
  if (value.length === 0) return null;
  const [first, ...rest] = value;
  const label = options.find((option) => option.value === first)?.label ?? first ?? "";
  return rest.length === 0 ? label : `${label}, +${String(rest.length)}`;
}

/** The selection after pressing one option: "all" and exact ids replace each other. */
function toggleSelection(value: MultiSelection | null, optionId: string): MultiSelection {
  if (optionId === ALL_OPTION_ID) return value === "*" ? [] : "*";
  const exact = value === null || value === "*" ? [] : value;
  return exact.includes(optionId) ? exact.filter((id) => id !== optionId) : [...exact, optionId];
}

/**
 * `SelectField` for several values: the same label, trigger, and Combobox, so it
 * sits on the same rails as the single-value fields around it. The list stays
 * open while choosing and closes like any popover or sheet. With `allLabel`,
 * "All" is the first option — a stored wildcard, not a separate button. Leave it
 * out where "all" would only mean "every option listed today".
 */
export function MultiSelectField({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  allLabel,
  placeholder,
  searchPlaceholder,
}: {
  label: string;
  hint?: string;
  options: readonly SelectFieldOption<string>[];
  value: MultiSelection | null;
  onChange(value: MultiSelection): void;
  disabled: boolean;
  allLabel?: string;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const toggleOpen = useCallback(() => setOpen((current) => !current), []);
  const onFocus = useCallback(
    (_event: NativeSyntheticEvent<TargetedEvent>) => setFocused(true),
    [],
  );
  const onBlur = useCallback(
    (_event: NativeSyntheticEvent<TargetedEvent>) => setFocused(false),
    [],
  );
  const select = useCallback(
    (optionId: string) => onChange(toggleSelection(value, optionId)),
    [onChange, value],
  );
  const comboboxOptions = useMemo(
    () => [
      ...(allLabel === undefined ? [] : [{ id: ALL_OPTION_ID, label: allLabel }]),
      ...options.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
        // Grouped options get the list's headings, as in `SelectField`.
        ...(option.group === undefined ? {} : { group: option.group }),
      })),
    ],
    [allLabel, options],
  );
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        {...(option.description === undefined ? {} : { description: option.description })}
        selected={
          option.id === ALL_OPTION_ID
            ? value === "*"
            : Array.isArray(value) && value.includes(option.id)
        }
        active={active}
        onPress={onPress}
      />
    ),
    [value],
  );
  const summary = selectionLabel(value, options, allLabel);
  const display = useMemo(() => (summary === null ? null : { label: summary }), [summary]);
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          disabled={disabled}
          onPress={toggleOpen}
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityRole="button"
          accessibilityLabel={`${label} (${summary ?? placeholder})`}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              display={display}
              placeholder={placeholder}
              hovered={Boolean(hovered)}
              focused={focused}
              active={pressed || open}
              disabled={disabled}
            />
          )}
        </Pressable>
      </View>
      <Combobox
        options={comboboxOptions}
        value=""
        onSelect={select}
        searchable
        searchPlaceholder={searchPlaceholder}
        emptyText="Nothing matches this search."
        title={label}
        open={open}
        onOpenChange={setOpen}
        keepOpenOnSelect
        anchorRef={anchorRef}
        renderOption={renderOption}
      />
    </Field>
  );
}

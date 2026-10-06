import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SetupRowView, type SetupRowLook } from "./bot-setup-card";

export interface SetupOption {
  id: string;
  label: string;
}

/**
 * A row that picks one of `options`. Without options, or with only the one already chosen, it
 * shows the value and does not open.
 */
export function SetupSelectRow({
  options,
  selectedId,
  onChange,
  emptyText,
  disabled = false,
  testID,
  ...look
}: SetupRowLook & {
  options: readonly SetupOption[];
  selectedId: string | null;
  onChange: (id: string) => void;
  emptyText: string;
  disabled?: boolean;
  testID?: string;
}) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  // One option that is already chosen is a fact, not a choice: no chevron, no picker.
  const alreadyOnly = options.length === 1 && options[0]?.id === selectedId;
  const interactive = !disabled && options.length > 0 && !alreadyOnly;
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ id: option.id, label: option.label })),
    [options],
  );
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const select = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );
  const renderRow = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
      <SetupRowView
        {...look}
        interactive={interactive}
        highlighted={Boolean(hovered) || pressed || open}
      />
    ),
    [look, interactive, open],
  );
  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          disabled={!interactive}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={`${look.label} (${look.value})`}
          testID={testID}
        >
          {renderRow}
        </Pressable>
      </View>
      {interactive ? (
        <Combobox
          options={comboboxOptions}
          value={selectedId ?? ""}
          onSelect={select}
          searchable={options.length > 6}
          emptyText={emptyText}
          title={look.label}
          open={open}
          onOpenChange={setOpen}
          anchorRef={anchorRef}
        />
      ) : null}
    </>
  );
}

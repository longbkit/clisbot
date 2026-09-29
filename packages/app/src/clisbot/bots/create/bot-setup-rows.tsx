import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { Theme } from "@/styles/theme";

const ThemedChevron = withUnistyles(ChevronDown);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One card of labeled rows, one per setting, so the settings read as a group and each value says
 * what it is. A row with a chevron opens its own picker.
 */
export function SetupCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export interface SetupRowLook {
  label: string;
  value: string;
  placeholder?: boolean;
  leading?: ReactNode;
  last?: boolean;
}

/** The row's look; the pressable around it owns the press. */
export function SetupRowView({
  label,
  value,
  placeholder = false,
  leading,
  last = false,
  interactive,
  highlighted,
  testID,
}: SetupRowLook & { interactive: boolean; highlighted: boolean; testID?: string }) {
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        !last && styles.divider,
        interactive && highlighted && styles.highlighted,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.value}>
        {leading}
        <Text numberOfLines={1} style={[styles.valueText, placeholder && styles.muted]}>
          {value}
        </Text>
      </View>
      {interactive ? <ThemedChevron size={16} uniProps={mutedIcon} /> : null}
    </View>
  );
}

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

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  highlighted: { backgroundColor: theme.colors.surface2 },
  label: { width: 96, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  value: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  valueText: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted },
}));

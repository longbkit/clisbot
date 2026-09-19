// Tabs that switch a page between its views (Channels: Connections,
// Integrations, …; People: Members, Invitations, …). An underlined text row on
// a rule, so it reads as navigation and never as a row of buttons.
// SegmentedControl stays for choosing an option inside a view (People |
// Resources), where matching a Button is what docs/design.md asks for.

import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface ViewTab<T extends string> {
  value: T;
  label: string;
}

export function ViewTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly ViewTab<T>[];
  value: NoInfer<T>;
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <View>
      <View style={styles.rule} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => (
          <Tab key={tab.value} tab={tab} selected={tab.value === value} onChange={onChange} />
        ))}
      </ScrollView>
    </View>
  );
}

function Tab<T extends string>({
  tab,
  selected,
  onChange,
}: {
  tab: ViewTab<T>;
  selected: boolean;
  onChange(value: T): void;
}) {
  const press = useCallback(() => {
    if (!selected) onChange(tab.value);
  }, [onChange, selected, tab.value]);
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tab,
      selected ? styles.tabSelected : null,
      Boolean(hovered) && !selected ? styles.tabHovered : null,
    ],
    [selected],
  );
  return (
    <Pressable accessibilityRole="tab" accessibilityState={state} onPress={press} style={style}>
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <Text
          numberOfLines={1}
          style={[styles.label, selected || Boolean(hovered) ? styles.labelActive : null]}
        >
          {tab.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Drawn under the tabs, so the selected tab's underline covers it.
  rule: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing[6],
  },
  tab: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabSelected: {
    borderBottomColor: theme.colors.foreground,
  },
  tabHovered: {
    borderBottomColor: theme.colors.border,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
}));

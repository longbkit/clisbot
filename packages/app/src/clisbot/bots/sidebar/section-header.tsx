import { useCallback, useState, useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Layers,
  LayoutGrid,
  ListFilter,
  Pin,
  Plus,
} from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import type { Theme } from "@/styles/theme";
const ThemedPlus = withUnistyles(Plus);
const Down = withUnistyles(ChevronDown);
const Right = withUnistyles(ChevronRight);
const icons = {
  Bots: withUnistyles(Bot),
  "Group chats": withUnistyles(ListFilter),
  Projects: withUnistyles(LayoutGrid),
  Pinned: withUnistyles(Pin),
};
const Fallback = withUnistyles(Layers);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function useSectionCollapsed(key: string) {
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedWorkspaceGroupKeys.has(`fusion:${key}`),
  );
  const toggle = useSidebarCollapsedSectionsStore((state) => state.toggleWorkspaceGroupCollapsed);
  return [collapsed, useCallback(() => toggle(`fusion:${key}`), [key, toggle])] as const;
}

export function BotsSectionHeader({
  label,
  testID,
  createLabel,
  onCreate,
  disabled = false,
  collapsed = false,
  onToggle,
  actions,
  nested = false,
}: {
  label: string;
  testID: string;
  createLabel?: string;
  onCreate?: () => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  nested?: boolean;
}) {
  const compact = useIsCompactFormFactor() || isNative;
  const [hovered, setHovered] = useState(false);
  const [createFocused, setCreateFocused] = useState(false);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const onPointerEnter = useCallback(() => setHovered(true), []);
  const onPointerLeave = useCallback(() => setHovered(false), []);
  const onCreateFocus = useCallback(() => setCreateFocused(true), []);
  const onCreateBlur = useCallback(() => setCreateFocused(false), []);
  const buttonStyle = useCallback(
    ({ hovered: buttonHovered, pressed }: import("react-native").PressableStateCallbackType) => [
      styles.button,
      compact && styles.touch,
      disabled && styles.disabled,
      !(hovered || createFocused || compact) && styles.actionHidden,
      (buttonHovered || pressed) && styles.hovered,
    ],
    [compact, disabled, hovered, createFocused],
  );
  const Icon = icons[label as keyof typeof icons] ?? Fallback;
  return (
    <View
      style={styles.header}
      testID={testID}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <Pressable
        style={[styles.heading, compact && styles.touch]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        aria-expanded={!collapsed}
        testID={`${testID}-toggle`}
      >
        {() => {
          const Chevron = collapsed ? Right : Down;
          const Leading = hovered && !compact ? Chevron : Icon;
          return (
            <>
              <View style={styles.iconSlot}>
                <Leading size={nested ? 14 : 16} uniProps={color} />
              </View>
              <Text numberOfLines={1} style={[styles.title, nested && styles.nestedTitle]}>
                {label}
              </Text>
            </>
          );
        }}
      </Pressable>
      {onCreate ? (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={createLabel}
              testID={`${testID}-create`}
              onPress={onCreate}
              onFocus={onCreateFocus}
              onBlur={onCreateBlur}
              style={buttonStyle}
            >
              <ThemedPlus size={16} uniProps={color} />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <Text>{createLabel}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      {actions}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  header: {
    // Separate top-level sections while keeping their headers and rows compact.
    marginTop: theme.spacing[3],
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    userSelect: "none",
  },
  heading: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 20,
    flexShrink: 1,
  },
  nestedTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  iconSlot: { width: 16, height: 20, alignItems: "center", justifyContent: "center" },
  // Collapsed rather than transparent, so the actions after it keep the right edge; still
  // reachable by keyboard, and focusing it shows it.
  actionHidden: { width: 0, minWidth: 0, opacity: 0, overflow: "hidden" },
  button: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  disabled: { opacity: 0.4 },
  touch: { minWidth: 44, minHeight: 44 },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
}));

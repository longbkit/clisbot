import { forwardRef, useMemo, type ComponentProps } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import type { AgentControlIcon } from "@/agent-controls/icons";

type AgentControlTriggerProps = Omit<
  ComponentProps<typeof ComboboxTrigger>,
  "accessibilityLabel" | "block" | "children" | "chevron" | "onPress" | "style"
> & {
  icon: AgentControlIcon;
  iconColor?: string;
  selectedBackgroundColor?: string;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  selected?: boolean;
  open?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

const TOOLBAR_ICON_HIT_SLOP = 8;
const TOOLBAR_LABEL_HIT_SLOP = { top: 8, bottom: 8 } as const;

function resolveAgentControlHitSlop(
  hitSlop: AgentControlTriggerProps["hitSlop"],
  surface: "toolbar" | "sheet",
  showToolbarLabel: boolean,
) {
  if (hitSlop !== undefined) {
    return hitSlop;
  }
  if (surface === "sheet") {
    return undefined;
  }
  if (showToolbarLabel) {
    return TOOLBAR_LABEL_HIT_SLOP;
  }
  return TOOLBAR_ICON_HIT_SLOP;
}

function buildAgentControlTriggerStyle(input: {
  isSheet: boolean;
  showToolbarLabel: boolean;
  selected: boolean;
  selectedBackgroundColor?: string;
  open: boolean;
  disabled: boolean;
}) {
  return ({ pressed, hovered }: PressableStateCallbackType) => [
    input.isSheet ? styles.sheetRow : styles.toolbarControl,
    !input.isSheet && !input.showToolbarLabel && styles.toolbarIconOnly,
    input.selected && {
      backgroundColor: input.selectedBackgroundColor ?? styles.selectedFallback.backgroundColor,
    },
    hovered && !input.selected && (input.isSheet ? styles.sheetRowInteractive : styles.hovered),
    (pressed || input.open) &&
      !input.selected &&
      (input.isSheet ? styles.sheetRowInteractive : styles.pressed),
    input.disabled && styles.disabled,
  ];
}

export const AgentControlTrigger = forwardRef<View, AgentControlTriggerProps>(
  function AgentControlTrigger(
    {
      icon: Icon,
      iconColor,
      selectedBackgroundColor,
      surface,
      label,
      value,
      showToolbarLabel = true,
      showCaret = false,
      selected = false,
      open = false,
      disabled = false,
      onPress,
      accessibilityLabel,
      accessibilityRole = "button",
      accessibilityState,
      testID,
      hitSlop,
      ...triggerProps
    },
    ref,
  ) {
    const { glyphSize } = useComposerControlLayout();
    const isSheet = surface === "sheet";
    const isSwitch = accessibilityRole === "switch";
    const isDisabled = disabled === true;
    const resolvedGlyphSize = isSheet ? 16 : glyphSize;
    const resolvedIconColor = iconColor ?? styles.iconColor.color;
    const showValue = isSheet || showToolbarLabel;
    const resolvedHitSlop = resolveAgentControlHitSlop(hitSlop, surface, showToolbarLabel);
    const selectedForeground = selected ? { color: resolvedIconColor } : null;
    const switchState = useMemo(
      () => (isSwitch ? { checked: selected, disabled: isDisabled } : undefined),
      [isDisabled, isSwitch, selected],
    );
    const triggerStyle = useMemo(
      () =>
        buildAgentControlTriggerStyle({
          isSheet,
          showToolbarLabel,
          selected,
          selectedBackgroundColor,
          open,
          disabled: isDisabled,
        }),
      [isDisabled, isSheet, open, selected, selectedBackgroundColor, showToolbarLabel],
    );

    return (
      <ComboboxTrigger
        {...triggerProps}
        ref={ref}
        collapsable={false}
        disabled={disabled}
        onPress={onPress}
        style={triggerStyle}
        hitSlop={resolvedHitSlop}
        accessibilityRole={accessibilityRole}
        accessibilityState={switchState ?? accessibilityState}
        aria-checked={isSwitch ? selected : undefined}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        chevron={showCaret ? undefined : null}
      >
        {isSheet ? (
          <View style={styles.sheetGlyph}>
            <Icon size={resolvedGlyphSize} color={resolvedIconColor} />
          </View>
        ) : (
          <ComposerToolbarGlyph size={resolvedGlyphSize}>
            <Icon size={resolvedGlyphSize} color={resolvedIconColor} />
          </ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <Text style={styles.sheetLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {showValue ? (
          <Text
            style={[
              isSheet ? styles.sheetValue : styles.toolbarValue,
              selected && styles.selectedValue,
              selectedForeground,
            ]}
            numberOfLines={1}
          >
            {value ?? label}
          </Text>
        ) : null}
      </ComboboxTrigger>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  toolbarControl: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  toolbarIconOnly: {
    width: 28,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetRow: {
    minHeight: 44,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface1,
  },
  sheetRowInteractive: {
    backgroundColor: theme.colors.surface2,
  },
  sheetGlyph: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabled: {
    opacity: 0.5,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  selectedFallback: {
    backgroundColor: theme.colors.surface2,
  },
  selectedValue: {
    fontWeight: theme.fontWeight.medium,
  },
}));

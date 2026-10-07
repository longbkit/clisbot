import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  createControlGeometry,
  segmentedIconSize,
  type SegmentedControlSize,
} from "@/components/ui/control-geometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

type SegmentedControlIconRenderer = (props: { color: string; size: number }) => ReactNode;

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: SegmentedControlIconRenderer;
  disabled?: boolean;
  testID?: string;
  /** Shown on hover (desktop only), for a label too short to say what the segment does. */
  tooltip?: string;
}

/**
 * `plain` — segments on whatever is behind them, the selected one filled `surface3`.
 * `track` — the segments sit in one bordered rail and the selected one is the raised card a
 * selected sidebar row is (`surfaceSidebarSelected` + `shadow.raised`). For a switcher that has to
 * read as one control among rows of similar text, such as the sidebar's grouping tabs.
 */
export type SegmentedControlVariant = "plain" | "track";

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: SegmentedControlSize;
  variant?: SegmentedControlVariant;
  hideLabels?: boolean;
  /** Rendered inside the control after the segments — a menu trigger drawn as a segment. */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One segment's style, for the control's own segments and for a `trailing` element that has to
 * look like one (a menu trigger), so the two never drift.
 */
export function segmentedSegmentStyle(input: {
  size: SegmentedControlSize;
  variant: SegmentedControlVariant;
  selected: boolean;
  hovered: boolean;
  pressed: boolean;
  disabled?: boolean;
}): StyleProp<ViewStyle> {
  const { selected, hovered, pressed } = input;
  return [
    styles.segment,
    SEGMENT_SIZE_STYLES[input.size],
    selected && (input.variant === "track" ? styles.segmentRaised : styles.segmentSelected),
    hovered &&
      !selected &&
      (input.variant === "track" ? styles.segmentTrackHover : styles.segmentHover),
    pressed && !selected && styles.segmentPressed,
    input.disabled && styles.segmentDisabled,
  ];
}

/** A segment's label style, for the same reason as `segmentedSegmentStyle`. */
export function segmentedLabelStyle(input: {
  size: SegmentedControlSize;
  selected: boolean;
  variant?: SegmentedControlVariant;
}): StyleProp<TextStyle> {
  return [
    styles.label,
    LABEL_SIZE_STYLES[input.size],
    input.selected && styles.labelSelected,
    input.selected && input.variant === "track" && styles.labelRaised,
  ];
}

interface SegmentIconProps {
  icon: SegmentedControlIconRenderer;
  iconSize: number;
  iconColor: string;
}

function SegmentIcon({ icon, iconSize, iconColor }: SegmentIconProps) {
  return <View style={styles.iconContainer}>{icon({ color: iconColor, size: iconSize })}</View>;
}

const ThemedSegmentIcon = withUnistyles(SegmentIcon);

const selectedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const mutedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foregroundMuted });

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  variant = "plain",
  hideLabels = false,
  trailing,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const containerSizeStyle = {
    xs: styles.containerXs,
    sm: styles.containerSm,
    md: styles.containerMd,
  }[size];
  const iconSize = segmentedIconSize[size];

  const trackStyle = variant === "track" ? TRACK_SIZE_STYLES[size] : null;
  const containerStyle = useMemo(
    () => [styles.container, containerSizeStyle, trackStyle && [styles.track, trackStyle], style],
    [containerSizeStyle, trackStyle, style],
  );

  return (
    <View style={containerStyle} testID={testID}>
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <SegmentItem
            key={option.value}
            option={option}
            isSelected={isSelected}
            iconSize={iconSize}
            hideLabels={hideLabels}
            size={size}
            variant={variant}
            currentValue={value}
            onValueChange={onValueChange}
          />
        );
      })}
      {trailing}
    </View>
  );
}

function SegmentItem<T extends string>({
  option,
  isSelected,
  iconSize,
  hideLabels,
  size,
  variant,
  currentValue,
  onValueChange,
}: {
  option: SegmentedControlOption<T>;
  isSelected: boolean;
  iconSize: number;
  hideLabels: boolean;
  size: SegmentedControlSize;
  variant: SegmentedControlVariant;
  currentValue: T;
  onValueChange: (value: T) => void;
}) {
  const labelStyle = useMemo(
    () => segmentedLabelStyle({ size, selected: isSelected, variant }),
    [size, isSelected, variant],
  );
  const handlePress = useCallback(() => {
    if (!option.disabled && option.value !== currentValue) {
      onValueChange(option.value);
    }
  }, [option.disabled, option.value, currentValue, onValueChange]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      segmentedSegmentStyle({
        size,
        variant,
        selected: isSelected,
        hovered: Boolean(hovered),
        pressed,
        disabled: option.disabled,
      }),
    [isSelected, option.disabled, size, variant],
  );
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled: option.disabled }),
    [isSelected, option.disabled],
  );
  const segment = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      aria-selected={isSelected}
      disabled={option.disabled}
      testID={option.testID}
      onPress={handlePress}
      style={pressableStyle}
    >
      {option.icon ? (
        <ThemedSegmentIcon
          icon={option.icon}
          iconSize={iconSize}
          uniProps={isSelected ? selectedIconMapping : mutedIconMapping}
        />
      ) : null}
      {hideLabels ? null : (
        <Text style={labelStyle} numberOfLines={1}>
          {option.label}
        </Text>
      )}
    </Pressable>
  );
  if (!option.tooltip) return segment;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{segment}</TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        <Text>{option.tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    container: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "transparent",
      gap: theme.spacing[1],
    },
    containerXs: {
      ...geometry.segmentedContainerXs,
    },
    containerSm: {
      ...geometry.segmentedContainerSm,
    },
    containerMd: {
      ...geometry.segmentedContainerMd,
    },
    trackXs: { ...geometry.segmentedTrackXs },
    trackSm: { ...geometry.segmentedTrackSm },
    trackMd: { ...geometry.segmentedTrackMd },
    segment: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      gap: theme.spacing[1],
    },
    segmentXs: {
      ...geometry.segmentedSegmentXs,
    },
    segmentSm: {
      ...geometry.segmentedSegmentSm,
    },
    segmentMd: {
      ...geometry.segmentedSegmentMd,
    },
    segmentSelected: {
      backgroundColor: theme.colors.surface3,
    },
    track: {
      backgroundColor: theme.colors.surfaceSegmentedTrack,
      borderColor: "transparent",
    },
    segmentTrackHover: {
      backgroundColor: theme.colors.surfaceSegmentedHover,
    },
    segmentRaised: {
      backgroundColor: theme.colors.surfaceSegmentedSelected,
      ...theme.shadow.raised,
    },
    segmentHover: {
      backgroundColor: theme.colors.surface2,
    },
    segmentPressed: {
      backgroundColor: theme.colors.surface3,
    },
    segmentDisabled: {
      opacity: theme.opacity[50],
    },
    iconContainer: {
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      color: theme.colors.foregroundMuted,
      fontWeight: theme.fontWeight.normal,
    },
    labelXs: {
      ...geometry.segmentedLabelXs,
    },
    labelSm: {
      ...geometry.segmentedLabelSm,
    },
    labelMd: {
      ...geometry.segmentedLabelMd,
    },
    labelSelected: {
      color: theme.colors.foreground,
    },
    labelRaised: {
      fontWeight: theme.fontWeight.medium,
    },
  };
});

const SEGMENT_SIZE_STYLES: Record<SegmentedControlSize, StyleProp<ViewStyle>> = {
  xs: styles.segmentXs,
  sm: styles.segmentSm,
  md: styles.segmentMd,
};

const LABEL_SIZE_STYLES: Record<SegmentedControlSize, StyleProp<TextStyle>> = {
  xs: styles.labelXs,
  sm: styles.labelSm,
  md: styles.labelMd,
};

const TRACK_SIZE_STYLES: Record<SegmentedControlSize, StyleProp<ViewStyle>> = {
  xs: styles.trackXs,
  sm: styles.trackSm,
  md: styles.trackMd,
};

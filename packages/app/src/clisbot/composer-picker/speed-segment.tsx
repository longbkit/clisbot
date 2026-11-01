import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Rocket, Zap } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SpeedLevel, SpeedOption, SpeedControl } from "./speed";
import { useTouchRows } from "./use-touch-rows";

/** The value shown when the agent runs a tier the control does not offer. */
const NONE = "none";

function renderZap({ color, size }: { color: string; size: number }) {
  return <Zap size={size} color={color} />;
}

function renderRocket({ color, size }: { color: string; size: number }) {
  return <Rocket size={size} color={color} />;
}

const LEVEL_PRESENTATION: Record<
  SpeedLevel,
  { labelKey: string; icon?: typeof renderZap; testID: string }
> = {
  standard: { labelKey: "composer.picker.standard", testID: "composer-picker-standard" },
  fast: { labelKey: "composer.picker.fast", icon: renderZap, testID: "composer-picker-fast" },
  ultra: {
    labelKey: "composer.picker.ultraFast",
    icon: renderRocket,
    testID: "composer-picker-ultra",
  },
};

function useSegmentOptions(options: readonly SpeedOption[]): SegmentedControlOption<string>[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      options.map((option) => {
        if (!option.level) {
          return {
            value: option.key,
            label: option.label,
            testID: `composer-picker-speed-${String(option.value)}`,
          };
        }
        const presentation = LEVEL_PRESENTATION[option.level];
        return {
          value: option.key,
          label: t(presentation.labelKey),
          icon: presentation.icon,
          testID: presentation.testID,
        };
      }),
    [options, t],
  );
}

/**
 * Standard | ⚡ Fast | Ultra fast, the levels the model sells, then any other tier under its
 * own name. A level above Standard says it costs more.
 */
export function SpeedSegment(props: {
  control: SpeedControl;
  onSetFeature: (featureId: string, value: unknown) => void;
}) {
  const touch = useTouchRows();
  const { t } = useTranslation();
  const { control, onSetFeature } = props;
  const options = useSegmentOptions(control.options);
  const change = useCallback(
    (key: string) => {
      const option = control.options.find((entry) => entry.key === key);
      if (option) onSetFeature(control.featureId, option.value);
    },
    [control, onSetFeature],
  );
  const selected = control.options.find((option) => option.key === control.selectedKey);
  return (
    <View style={styles.row}>
      <SegmentedControl
        options={options}
        value={control.selectedKey ?? NONE}
        onValueChange={change}
        size={touch ? "md" : "sm"}
        touch={touch}
        accessibilityLabel={t("composer.picker.speed")}
        testID="composer-picker-speed"
      />
      {selected?.costsMore ? (
        <StatusBadge label={t("composer.picker.higherCost")} variant="warning" size="xs" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    flexShrink: 1,
  },
}));

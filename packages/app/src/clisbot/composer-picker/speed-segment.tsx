import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Zap } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SpeedChoice, SpeedControl } from "./speed";

type SegmentValue = SpeedChoice | "other";

function renderZap({ color, size }: { color: string; size: number }) {
  return <Zap size={size} color={color} />;
}

/** Standard | ⚡ Fast for the providers that sell a faster tier; Fast says it costs more. */
export function SpeedSegment(props: {
  control: SpeedControl;
  onSetFeature: (featureId: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const { control, onSetFeature } = props;
  const options = useMemo<SegmentedControlOption<SegmentValue>[]>(
    () => [
      {
        value: "standard",
        label: t("composer.picker.standard"),
        testID: "composer-picker-standard",
      },
      {
        value: "fast",
        label: t("composer.picker.fast"),
        icon: renderZap,
        testID: "composer-picker-fast",
      },
    ],
    [t],
  );
  const change = useCallback(
    (value: SegmentValue) => {
      if (value !== "other") onSetFeature(control.featureId, control.values[value]);
    },
    [control, onSetFeature],
  );
  return (
    <View style={styles.row}>
      <SegmentedControl
        options={options}
        value={control.selected ?? "other"}
        onValueChange={change}
        size="sm"
        accessibilityLabel={t("composer.picker.speed")}
        testID="composer-picker-speed"
      />
      {control.selected === "fast" ? (
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
  },
}));

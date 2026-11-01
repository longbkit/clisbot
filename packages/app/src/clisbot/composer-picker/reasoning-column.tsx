import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComboboxItem } from "@/components/ui/combobox";
import { ChipButton, ChipRow } from "@/components/ui/filter-chips";

export interface ReasoningOption {
  id: string;
  label: string;
  isDefault?: boolean;
}

export interface ReasoningColumnProps {
  /** The selected model's short name, in the header. */
  modelName: string;
  options: readonly ReasoningOption[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** A column beside the list, or a chip row in the phone sheet. */
  orientation: "vertical" | "horizontal";
  /** Showing a hovered model's efforts; kept on screen even when it has none. */
  previewing?: boolean;
}

function ReasoningRow(props: {
  option: ReasoningOption;
  selected: boolean;
  orientation: ReasoningColumnProps["orientation"];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { option, onSelect } = props;
  const press = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  const testID = `composer-picker-effort-${option.id}`;
  if (props.orientation === "horizontal") {
    return (
      <ChipButton
        role="tab"
        label={option.label}
        selected={props.selected}
        touch
        onPress={press}
        testID={testID}
      />
    );
  }
  return (
    <ComboboxItem
      label={option.label}
      description={option.isDefault ? t("composer.picker.defaultEffort") : undefined}
      selected={props.selected}
      onPress={press}
      testID={testID}
    />
  );
}

/** The selected model's effort levels; the provider's default is marked Default. */
export function ReasoningColumn(props: ReasoningColumnProps) {
  const { t } = useTranslation();
  if (props.options.length === 0 && !props.previewing) return null;
  const rows = props.options.map((option) => (
    <ReasoningRow
      key={option.id}
      option={option}
      selected={option.id === props.selectedId}
      orientation={props.orientation}
      onSelect={props.onSelect}
    />
  ));
  const vertical = props.orientation === "vertical";
  return (
    <View style={vertical ? styles.column : styles.section} testID="composer-picker-reasoning">
      <Text style={styles.heading} numberOfLines={1}>
        {t("composer.picker.reasoning")}
        <Text style={styles.headingModel}>{` · ${props.modelName}`}</Text>
      </Text>
      {vertical ? (
        rows
      ) : (
        <ChipRow contentStyle={styles.chipContent}>
          <View style={styles.chipLine}>{rows}</View>
        </ChipRow>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    width: 200,
    paddingVertical: theme.spacing[2],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.borderSubtle,
  },
  section: {
    paddingTop: theme.spacing[2],
  },
  heading: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  headingModel: {
    fontWeight: theme.fontWeight.normal,
  },
  chipContent: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  chipLine: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));

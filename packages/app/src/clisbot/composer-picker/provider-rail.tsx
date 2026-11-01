import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Star, UserRound } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { ChipButton, ChipRow } from "@/components/ui/filter-chips";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { ICON_SIZE } from "@/styles/theme";
import { scopeKey, type PickerRailItem, type PickerScope } from "./picker-rows";

interface ProviderRailProps {
  items: readonly PickerRailItem[];
  scope: PickerScope;
  serverId: string | null;
  onSelect: (scope: PickerScope) => void;
  /** A column of icons with tooltips beside the list, or a labelled chip row on a phone. */
  orientation: "vertical" | "horizontal";
}

function RailGlyph({ item, serverId }: { item: PickerRailItem; serverId: string | null }) {
  if (item.scope.kind === "favorites") {
    return <Star size={ICON_SIZE.md} color={styles.glyph.color} />;
  }
  if (item.scope.kind === "profiles") {
    return <UserRound size={ICON_SIZE.md} color={styles.glyph.color} />;
  }
  return (
    <ModelProviderGlyph provider={item.scope.providerId} serverId={serverId} size={ICON_SIZE.md} />
  );
}

function useRailLabel(): (item: PickerRailItem) => string {
  const { t } = useTranslation();
  return useCallback(
    (item) => {
      if (item.scope.kind === "favorites") return t("composer.picker.favorites");
      if (item.scope.kind === "profiles") return t("composer.picker.profiles");
      return item.label ?? item.key;
    },
    [t],
  );
}

function RailButton(props: {
  item: PickerRailItem;
  label: string;
  selected: boolean;
  serverId: string | null;
  orientation: ProviderRailProps["orientation"];
  onSelect: (scope: PickerScope) => void;
}) {
  const { item, onSelect } = props;
  const press = useCallback(() => onSelect(item.scope), [item.scope, onSelect]);
  const glyph = useMemo(
    () => <RailGlyph item={item} serverId={props.serverId} />,
    [item, props.serverId],
  );
  const testID = `composer-picker-rail-${item.key}`;
  if (props.orientation === "horizontal") {
    return (
      <ChipButton
        role="tab"
        label={props.label}
        leading={glyph}
        selected={props.selected}
        onPress={press}
        testID={testID}
      />
    );
  }
  return (
    <View style={styles.railSlot}>
      {props.selected ? <View style={styles.accentBar} /> : null}
      <ToolbarButton
        label={props.label}
        selected={props.selected}
        tooltipSide="right"
        onPress={press}
        testID={testID}
      >
        {glyph}
      </ToolbarButton>
    </View>
  );
}

/** Favorites, each provider, then the Host's Agent profiles. */
export function ProviderRail(props: ProviderRailProps) {
  const labelOf = useRailLabel();
  const current = scopeKey(props.scope);
  const buttons = props.items.map((item) => (
    <RailButton
      key={item.key}
      item={item}
      label={labelOf(item)}
      selected={item.key === current}
      serverId={props.serverId}
      orientation={props.orientation}
      onSelect={props.onSelect}
    />
  ));
  if (props.orientation === "vertical") {
    return (
      <View style={styles.column} accessibilityRole="tablist">
        {buttons}
      </View>
    );
  }
  return (
    <ChipRow backdrop="surface0" contentStyle={styles.chipRowContent}>
      <View style={styles.chipLine} accessibilityRole="tablist">
        {buttons}
      </View>
    </ChipRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSubtle,
  },
  railSlot: {
    position: "relative",
    paddingLeft: theme.spacing[1],
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: theme.spacing[1],
    bottom: theme.spacing[1],
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  chipRowContent: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  chipLine: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  glyph: {
    color: theme.colors.foregroundMuted,
  },
}));

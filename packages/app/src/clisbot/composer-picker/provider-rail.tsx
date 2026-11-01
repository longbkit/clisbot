import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { PanelLeftClose, PanelLeftOpen, Star, UserRound } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { ComboboxItem } from "@/components/ui/combobox";
import { ChipButton, ChipRow } from "@/components/ui/filter-chips";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { ScrollView } from "@/components/ui/scroll-view";
import { ICON_SIZE } from "@/styles/theme";
import { scopeKey, type PickerRailItem, type PickerScope } from "./picker-rows";

interface ProviderRailProps {
  items: readonly PickerRailItem[];
  scope: PickerScope;
  serverId: string | null;
  onSelect: (scope: PickerScope) => void;
  /**
   * `collapsed`: a column of icons with tooltips. `expanded`: icon and name per row.
   * `horizontal`: a scrolling chip row with names, on a phone.
   */
  layout: RailLayout;
  /** Shows or hides the names; the vertical rail's bottom button. */
  onToggleExpanded?: () => void;
}

export type RailLayout = "collapsed" | "expanded" | "horizontal";

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
  layout: RailLayout;
  onSelect: (scope: PickerScope) => void;
}) {
  const { item, onSelect } = props;
  const press = useCallback(() => onSelect(item.scope), [item.scope, onSelect]);
  const glyph = useMemo(
    () => <RailGlyph item={item} serverId={props.serverId} />,
    [item, props.serverId],
  );
  const testID = `composer-picker-rail-${item.key}`;
  if (props.layout === "horizontal") {
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
      {props.layout === "expanded" ? (
        <ComboboxItem
          label={props.label}
          leadingSlot={glyph}
          active={props.selected}
          onPress={press}
          testID={testID}
        />
      ) : (
        <ToolbarButton
          label={props.label}
          selected={props.selected}
          tooltipSide="right"
          onPress={press}
          testID={testID}
        >
          {glyph}
        </ToolbarButton>
      )}
    </View>
  );
}

function ExpandToggle(props: { expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const Icon = props.expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <View style={props.expanded ? styles.toggleExpanded : styles.toggle}>
      <ToolbarButton
        label={t(props.expanded ? "composer.picker.collapseRail" : "composer.picker.expandRail")}
        tooltipSide="right"
        onPress={props.onToggle}
        testID="composer-picker-rail-toggle"
      >
        <Icon size={ICON_SIZE.md} color={styles.glyph.color} />
      </ToolbarButton>
    </View>
  );
}

/** Favorites, each provider in the user's order, then the Host's Agent profiles. */
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
      layout={props.layout}
      onSelect={props.onSelect}
    />
  ));
  if (props.layout === "horizontal") {
    return (
      <ChipRow backdrop="surface0" contentStyle={styles.chipRowContent}>
        <View style={styles.chipLine} accessibilityRole="tablist">
          {buttons}
        </View>
      </ChipRow>
    );
  }
  const expanded = props.layout === "expanded";
  return (
    <View
      style={expanded ? styles.columnExpanded : styles.column}
      testID={`composer-picker-rail-${props.layout}`}
    >
      {/* A Host with many providers outgrows the panel's height, so the entries scroll and the
          toggle stays pinned below them. */}
      <ScrollView
        style={styles.rowsScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={expanded ? styles.rowsExpanded : styles.rows} accessibilityRole="tablist">
          {buttons}
        </View>
      </ScrollView>
      {props.onToggleExpanded ? (
        <ExpandToggle expanded={expanded} onToggle={props.onToggleExpanded} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSubtle,
  },
  columnExpanded: {
    width: 176,
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSubtle,
  },
  rowsScroll: {
    flex: 1,
    minHeight: 0,
  },
  rows: {
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowsExpanded: {
    gap: 0,
  },
  toggle: {
    alignItems: "center",
  },
  toggleExpanded: {
    alignItems: "flex-start",
    paddingLeft: theme.spacing[2],
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

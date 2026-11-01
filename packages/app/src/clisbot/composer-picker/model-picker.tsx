import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox } from "@/components/ui/combobox";
import { ScrollView } from "@/components/ui/scroll-view";
import type { AgentModeControlValue } from "@/composer/agent-controls/mode-control";
import { useComposerPickerPlacement } from "@/composer/picker-placement";
import { isWeb } from "@/constants/platform";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { ModeDropdown } from "./mode-dropdown";
import { MoreFeatures } from "./more-features";
import { buildRailItems } from "./picker-rows";
import { ProviderRail } from "./provider-rail";
import { ReasoningColumn } from "./reasoning-column";
import { SpeedSegment } from "./speed-segment";
import type { SpeedControl } from "./speed";
import { useModelPickerState, type ModelPickerState } from "./use-model-picker-state";
import { usePickerKeyboard } from "./use-picker-keyboard";
import { PanelList } from "./panel-list";
import type { ProviderRefresh } from "./use-provider-refresh";
import { useProviderRail, type ProviderRailControl } from "./use-provider-rail";
import {
  useReasoningPreview,
  type PickModelWithEffort,
  type ReasoningProps,
} from "./use-reasoning-preview";

const EMPTY_OPTIONS: never[] = [];
const PANEL_HEIGHT = 440;
const PANEL_WIDTH = 640;
const PANEL_WIDTH_EXPANDED = 760;

function noop() {}

export interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<View | null>;
  isCompact: boolean;
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModelId: string;
  serverId: string | null;
  onPickModel: (provider: string, modelId: string) => void;
  reasoning: ReasoningProps;
  /** Picks a previewed model with one of its efforts. */
  onPickModelWithEffort?: (provider: string, modelId: string, effortId: string) => void;
  speed: SpeedControl | null;
  moreFeatures: readonly AgentFeature[];
  onSetFeature: (featureId: string, value: unknown) => void;
  mode: AgentModeControlValue | null;
  profiles: AgentProfilePicker | null;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  /** Reloads one provider's model list (the provider snapshot refresh Settings uses). */
  onRefreshProvider?: ProviderRefresh;
}

export type PanelProps = ModelPickerProps & {
  state: ModelPickerState;
  rail: ProviderRailControl;
  onPick: (row: ProviderSelectionModelRow) => void;
  onHoverRow?: (key: string) => void;
};

function useSearchHeader(state: ModelPickerState, open: boolean, isCompact: boolean): SheetHeader {
  const { t } = useTranslation();
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (open) setResetKey((key) => key + 1);
  }, [open]);
  return useMemo(
    () => ({
      title: t("composer.picker.title"),
      search: {
        onChange: state.setQuery,
        placeholder: t("composer.picker.searchPlaceholder"),
        autoFocus: isWeb && !isCompact,
        resetKey,
        testID: "composer-picker-search",
      },
    }),
    [isCompact, resetKey, state.setQuery, t],
  );
}

function PanelBody(props: PanelProps & { onLeaveList: () => void }) {
  const { state, isCompact } = props;
  const railItems = useMemo(
    () =>
      // A Host with Agent profiles keeps the entry with none applicable: it leads to them.
      buildRailItems(props.rail.providers, { hasProfiles: props.profiles !== null }),
    [props.profiles, props.rail.providers],
  );
  const orientation = isCompact ? "horizontal" : "vertical";
  const rail = (
    <ProviderRail
      items={railItems}
      scope={state.scope}
      serverId={props.serverId}
      onSelect={state.setScope}
      layout={props.rail.layout}
      onToggleExpanded={isCompact ? undefined : props.rail.toggle}
    />
  );
  const reasoning = <ReasoningColumn {...props.reasoning} orientation={orientation} />;
  const more = <MoreFeatures features={props.moreFeatures} onSetFeature={props.onSetFeature} />;
  if (isCompact) {
    return (
      <View testID="composer-picker-panel">
        {rail}
        <PanelList {...props} />
        {reasoning}
        {more}
      </View>
    );
  }
  return (
    <View style={styles.desktopPanel} testID="composer-picker-panel">
      <View style={styles.columns}>
        {rail}
        {/* Leaving the list and its Reasoning column ends a preview; moving onto the column
            keeps it, so a previewed effort can be pressed. */}
        <View style={styles.columns} onPointerLeave={props.onLeaveList}>
          <ScrollView style={styles.listScroll} keyboardShouldPersistTaps="handled">
            <PanelList {...props} />
          </ScrollView>
          {reasoning}
        </View>
      </View>
      {more}
    </View>
  );
}

function PanelFooter(props: ModelPickerProps) {
  if (!props.speed && !props.mode) return null;
  return (
    <View style={styles.footer} testID="composer-picker-footer">
      {props.speed ? (
        <SpeedSegment control={props.speed} onSetFeature={props.onSetFeature} />
      ) : (
        <View />
      )}
      {props.mode ? (
        <ModeDropdown
          {...props.mode}
          showLabel
          ownsCycleShortcut={false}
          testID="composer-picker-mode"
        />
      ) : null}
    </View>
  );
}

/**
 * One panel for every option the bar does not show: provider rail, model search and list,
 * reasoning, Standard | Fast, other provider options and Mode. A popover on desktop and a
 * bottom sheet on a phone (Combobox). Picking never closes it; Escape and outside do.
 */
export function ModelPicker(props: ModelPickerProps) {
  const placement = useComposerPickerPlacement();
  const rail = useProviderRail({
    providers: props.providers,
    isCompact: props.isCompact,
    serverId: props.serverId,
    refresh: props.onRefreshProvider,
  });
  const state = useModelPickerState({
    providers: rail.providers,
    selectedProvider: props.selectedProvider,
    selectedModelId: props.selectedModelId,
    open: props.open,
  });
  const header = useSearchHeader(state, props.open, props.isCompact);
  const footer = useMemo(() => <PanelFooter {...props} />, [props]);
  const { onPickModel } = props;
  const pick = useCallback(
    (row: ProviderSelectionModelRow) => onPickModel(row.provider, row.modelId),
    [onPickModel],
  );
  const pickIndex = useCallback(
    (index: number) => {
      const row = state.rows[index];
      if (row) pick(row);
    },
    [pick, state.rows],
  );
  const { onPickModelWithEffort } = props;
  const pickWithEffort = useCallback<PickModelWithEffort>(
    (row, effortId) =>
      onPickModelWithEffort
        ? onPickModelWithEffort(row.provider, row.modelId, effortId)
        : pick(row),
    [onPickModelWithEffort, pick],
  );
  const preview = useReasoningPreview({
    enabled: !props.isCompact,
    rows: state.rows,
    highlight: state.highlight,
    selectedKey: state.selectedKey,
    reasoning: props.reasoning,
    onPickWithEffort: pickWithEffort,
  });
  usePickerKeyboard({
    enabled: props.open && !props.isCompact,
    rowCount: state.rows.length,
    highlight: state.highlight,
    setHighlight: state.setHighlight,
    onPickIndex: pickIndex,
  });
  return (
    <Combobox
      options={EMPTY_OPTIONS}
      value=""
      onSelect={noop}
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchorRef={props.anchorRef}
      desktopPlacement={placement}
      desktopMinWidth={rail.layout === "expanded" ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH}
      desktopLockWidth
      desktopFixedHeight={PANEL_HEIGHT}
      desktopChildrenScrollEnabled={false}
      header={header}
      footer={footer}
      mobileChildrenContentContainerStyle={styles.mobileContent}
    >
      <PanelBody
        {...props}
        reasoning={preview.reasoning}
        state={state}
        rail={rail}
        onPick={pick}
        onHoverRow={preview.onHoverRow}
        onLeaveList={preview.onLeaveList}
      />
    </Combobox>
  );
}

const styles = StyleSheet.create((theme) => ({
  desktopPanel: {
    flex: 1,
    minHeight: 0,
  },
  columns: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  listScroll: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  mobileContent: {
    paddingHorizontal: 0,
  },
}));

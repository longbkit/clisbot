import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PluginComposerItems, usePluginComposerItemCount } from "@/plugins/composer-items";
import {
  PluginToolbarSlot,
  usePluginToolbarWidth,
} from "@/composer/agent-controls/plugin-toolbar-slot";
import { useComposerSheetBridge } from "@/composer/agent-controls/sheet-bridge";
import { View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { readMeasuredWidth } from "@/hooks/use-container-width";
import { controlSizingForLayout } from "@/components/ui/control-sizing";
import {
  composerToolbarGeometry,
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  type ComposerControlDensity,
  type ComposerControlPresence,
  type ComposerToolbarGeometry,
} from "@/composer/agent-controls/layout";
import { ComposerControlLayoutProvider } from "@/composer/agent-controls/layout-context";
import type { ControlledAgentControlsProps } from "@/composer/agent-controls/index";
import { ComposerPickerControls } from "./composer-picker-controls";

/**
 * The composer bar's agent controls when the picker is on (`feature.ts`): the Model chip, its
 * panel and the Mode dropdown, fed the same props as the upstream toolbar in
 * `composer/agent-controls/index.tsx`, which renders this instead of its own controls.
 */

type AgentControlOption = NonNullable<ControlledAgentControlsProps["modelOptions"]>[number];

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
    isDefault: option.isDefault,
  }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: `${provider}:${option.id}`,
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function pickDesktopModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectModel,
  onSelectProviderAndModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId === currentProvider) {
    onSelectModel?.(modelId);
  }
}

const EMPTY_FEATURE_PRESENCE: ComposerControlPresence["features"] = [];

/** How much of the bar fits: the effort leaves the Model chip first, then the Mode label. */
function useComposerControlDensity(input: {
  isCompact: boolean;
  hasMode: boolean;
  pluginItemsWidth: number;
  geometry: ComposerToolbarGeometry;
}) {
  const { geometry } = input;
  const { fontScale } = useWindowDimensions();
  const initialDensity: ComposerControlDensity = input.isCompact ? "tight" : "full";
  const [density, setDensity] = useState<ComposerControlDensity>(initialDensity);
  const densityRef = useRef<ComposerControlDensity>(initialDensity);
  const availableWidthRef = useRef(0);
  const controls = useMemo<ComposerControlPresence>(
    () => ({
      hasModel: true,
      hasThinking: false,
      hasMode: input.hasMode,
      features: EMPTY_FEATURE_PRESENCE,
      pluginItemsWidth: input.pluginItemsWidth,
      fontScale,
    }),
    [fontScale, input.hasMode, input.pluginItemsWidth],
  );
  const update = useCallback(
    (availableWidth: number) => {
      const next = resolveComposerControlDensity({
        availableWidth,
        currentDensity: densityRef.current,
        controls,
        geometry,
      });
      if (next === densityRef.current) return;
      densityRef.current = next;
      setDensity(next);
    },
    [controls, geometry],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const availableWidth = readMeasuredWidth(event);
      if (availableWidth === null) return;
      availableWidthRef.current = availableWidth;
      update(availableWidth);
    },
    [update],
  );
  useEffect(() => {
    if (availableWidthRef.current > 0) update(availableWidthRef.current);
  }, [update]);
  return { density, handleLayout };
}

function PluginItemsOverflow({
  serverId,
  disabled,
}: {
  serverId: string | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const bridge = useComposerSheetBridge();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const header = useMemo(() => ({ title: t("agentControls.features.title") }), [t]);
  return (
    <>
      <Button
        variant="ghost"
        leftIcon={Settings2}
        accessibilityLabel={t("agentControls.features.open")}
        testID="agent-controls-features"
        disabled={disabled}
        onPress={show}
      />
      <AdaptiveModalSheet
        header={header}
        visible={open}
        onClose={close}
        contextBridge={bridge}
        testID="agent-features-sheet"
      >
        <PluginComposerItems serverId={serverId} surface="sheet" />
      </AdaptiveModalSheet>
    </>
  );
}

export function PickerAgentControls({
  provider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  agentProfiles = null,
  onEditAgentProfiles,
  onCreateAgentProfile,
  onEditAgentProfile,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  modeControl,
  modelSelectorServerId = null,
  isCompactLayout,
  closesOnProviderChange = false,
}: ControlledAgentControlsProps) {
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  // As the upstream toolbar: control sizes follow the window layout, not a narrow pane.
  const toolbarSizing = controlSizingForLayout(isCompactFormFactor);
  const toolbarGeometry = useMemo(() => composerToolbarGeometry(toolbarSizing), [toolbarSizing]);
  const pluginItemCount = usePluginComposerItemCount(modelSelectorServerId);
  const { width: pluginItemsWidth, onLayout: handlePluginLayout } = usePluginToolbarWidth();
  const { density, handleLayout } = useComposerControlDensity({
    isCompact,
    hasMode: Boolean(modeControl),
    pluginItemsWidth,
    geometry: toolbarGeometry,
  });
  const presentation = resolveComposerControlPresentation(density);
  const layoutContextValue = useMemo(
    () => ({
      glyphs: toolbarGeometry.glyphs,
      presentation,
    }),
    [presentation, toolbarGeometry],
  );
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const providers = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const handlePickModel = useCallback(
    (nextProviderId: string, modelId: string) =>
      pickDesktopModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectModel,
        onSelectProviderAndModel,
      }),
    [onSelectModel, onSelectProviderAndModel, provider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );
  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => onSetFeature?.(featureId, value),
    [onSetFeature],
  );
  if (!onSelectModel && !modeControl && !pluginItemCount) return null;
  return (
    <ComposerControlLayoutProvider value={layoutContextValue}>
      <View style={styles.container} onLayout={handleLayout} testID="agent-controls-toolbar">
        <ComposerPickerControls
          provider={provider}
          providers={providers}
          selectedModelId={selectedModelId ?? ""}
          onPickModel={handlePickModel}
          closeOnProviderChange={closesOnProviderChange}
          thinkingOptions={formattedThinkingOptions}
          selectedThinkingOptionId={selectedThinkingOptionId}
          onSelectThinking={handleThinkingSelect}
          features={features}
          onSetFeature={handleSetFeature}
          modeControl={modeControl ?? null}
          profiles={agentProfiles}
          onCreateProfile={onCreateAgentProfile}
          onEditProfiles={onEditAgentProfiles}
          onEditProfile={onEditAgentProfile}
          onRefreshProvider={onRetryModelProvider}
          serverId={modelSelectorServerId}
          disabled={disabled || !onSelectModel}
          isModelLoading={isModelLoading}
          isCompact={isCompact}
          showEffort={!isCompact && density !== "tight"}
          showModeLabel={!isCompact && presentation.showModeLabel}
          glyphSize={layoutContextValue.glyphs.label.size}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
        />
        {!isCompact ? (
          <PluginToolbarSlot
            serverId={modelSelectorServerId}
            width={pluginItemsWidth}
            fits={!presentation.aggregateFeatures}
            onLayout={handlePluginLayout}
          />
        ) : null}
        {pluginItemCount > 0 && (isCompact || presentation.aggregateFeatures) ? (
          <PluginItemsOverflow serverId={modelSelectorServerId} disabled={disabled} />
        ) : null}
      </View>
    </ComposerControlLayoutProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    overflow: "hidden",
  },
}));

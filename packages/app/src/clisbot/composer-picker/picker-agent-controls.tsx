import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { readMeasuredWidth } from "@/hooks/use-container-width";
import { isNative } from "@/constants/platform";
import {
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  resolveComposerToolbarGlyphSize,
  type ComposerControlDensity,
  type ComposerControlPresence,
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
function useComposerControlDensity(input: { isCompact: boolean; hasMode: boolean }) {
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
      fontScale,
    }),
    [fontScale, input.hasMode],
  );
  const update = useCallback(
    (availableWidth: number) => {
      const next = resolveComposerControlDensity({
        availableWidth,
        currentDensity: densityRef.current,
        controls,
      });
      if (next === densityRef.current) return;
      densityRef.current = next;
      setDensity(next);
    },
    [controls],
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
}: ControlledAgentControlsProps) {
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const { density, handleLayout } = useComposerControlDensity({
    isCompact,
    hasMode: Boolean(modeControl),
  });
  const presentation = resolveComposerControlPresentation(density);
  const layoutContextValue = useMemo(
    () => ({
      glyphSize: resolveComposerToolbarGlyphSize(isNative ? "native" : "web"),
      presentation,
    }),
    [presentation],
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
  if (!onSelectModel && !modeControl) return null;
  return (
    <ComposerControlLayoutProvider value={layoutContextValue}>
      <View style={styles.container} onLayout={handleLayout}>
        <ComposerPickerControls
          provider={provider}
          providers={providers}
          selectedModelId={selectedModelId ?? ""}
          onPickModel={handlePickModel}
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
          glyphSize={layoutContextValue.glyphSize}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
        />
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

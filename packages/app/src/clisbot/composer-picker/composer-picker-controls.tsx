import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, View } from "react-native";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import type { AgentModeControlValue } from "@/composer/agent-controls/mode-control";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useHostFeature } from "@/runtime/host-features";
import { ModeDropdown } from "./mode-dropdown";
import { ModelChip } from "./model-chip";
import { formatCompactModelName, formatModelChipLabel } from "./model-name";
import { ModelPicker } from "./model-picker";
import type { ReasoningOption } from "./reasoning-column";
import { resolvePanelFeatures } from "./speed";
import type { ProviderRefresh } from "./use-provider-refresh";

export interface ComposerPickerControlsProps {
  provider: string;
  providers: readonly ProviderSelectorProvider[];
  selectedModelId: string;
  onPickModel: (provider: string, modelId: string) => void;
  thinkingOptions: readonly ReasoningOption[];
  selectedThinkingOptionId: string | undefined;
  onSelectThinking: (thinkingOptionId: string) => void;
  features: readonly AgentFeature[] | undefined;
  onSetFeature: (featureId: string, value: unknown) => void;
  modeControl: AgentModeControlValue | null;
  profiles: AgentProfilePicker | null;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  /** Opens the Host's Agent profiles settings. */
  onEditProfiles?: () => void;
  onEditProfile?: (profileId: string) => void;
  onRefreshProvider?: ProviderRefresh;
  serverId: string | null;
  disabled: boolean;
  isModelLoading: boolean;
  isCompact: boolean;
  /** Room on the bar: the effort leaves the chip first, then the Mode label. */
  showEffort: boolean;
  showModeLabel: boolean;
  glyphSize: number;
  onOpen?: () => void;
  onClose?: () => void;
}

function findModelLabel(
  providers: readonly ProviderSelectorProvider[],
  provider: string,
  modelId: string,
) {
  const selection = providers.find((entry) => entry.id === provider)?.modelSelection;
  if (selection?.kind !== "models") return null;
  return selection.rows.find((row) => row.modelId === modelId)?.modelLabel ?? null;
}

function useChipLabels(props: ComposerPickerControlsProps) {
  const { t } = useTranslation();
  const modelLabel =
    findModelLabel(props.providers, props.provider, props.selectedModelId) ??
    (props.isModelLoading ? t("composer.picker.loading") : props.selectedModelId);
  const effort = props.thinkingOptions.find(
    (option) => option.id === props.selectedThinkingOptionId,
  );
  const full = formatModelChipLabel(modelLabel, effort?.label ?? null);
  return {
    modelName: formatCompactModelName(modelLabel),
    chip: props.showEffort ? full : formatCompactModelName(modelLabel),
    // A screen reader has room for the model's full name, and the effort even when the chip
    // has dropped it.
    accessibility: t("composer.picker.chip", {
      value: effort ? `${modelLabel}, ${effort.label}` : modelLabel,
    }),
  };
}

function useClosingFirst<A extends unknown[]>(
  close: () => void,
  action: ((...args: A) => void) | undefined,
): ((...args: A) => void) | undefined {
  return useMemo(
    () =>
      action
        ? (...args: A) => {
            close();
            action(...args);
          }
        : undefined,
    [action, close],
  );
}

/**
 * Picks a model, then its effort once the composer reports the model as selected: a live
 * agent confirms the model asynchronously, and the effort list belongs to the new model.
 */
function usePickModelWithEffort(props: ComposerPickerControlsProps) {
  const pending = useRef<{ provider: string; modelId: string; effortId: string } | null>(null);
  const { onPickModel, onSelectThinking, provider, selectedModelId, thinkingOptions } = props;
  useEffect(() => {
    const next = pending.current;
    if (!next || next.provider !== provider || next.modelId !== selectedModelId) return;
    if (!thinkingOptions.some((option) => option.id === next.effortId)) return;
    pending.current = null;
    onSelectThinking(next.effortId);
  }, [onSelectThinking, provider, selectedModelId, thinkingOptions]);
  return useCallback(
    (nextProvider: string, modelId: string, effortId: string) => {
      pending.current = { provider: nextProvider, modelId, effortId };
      onPickModel(nextProvider, modelId);
    },
    [onPickModel],
  );
}

/** The composer bar's two controls: the Model chip, which opens the panel, and Mode. */
export function ComposerPickerControls(props: ComposerPickerControlsProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const fullAutoAcceptSupported = useHostFeature(props.serverId, "fullAutoAccept");
  const labels = useChipLabels(props);
  const pickModelWithEffort = usePickModelWithEffort(props);
  const { onOpen, onClose } = props;
  const panelFeatures = useMemo(
    () => resolvePanelFeatures(props.features ?? [], { fullAutoAcceptSupported }),
    [fullAutoAcceptSupported, props.features],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) Keyboard.dismiss();
      setOpen(next);
      if (next) onOpen?.();
      else onClose?.();
    },
    [onClose, onOpen],
  );
  const toggle = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  // The profile editor and Host settings are surfaces of their own; they open once the panel
  // has closed.
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);
  const createProfile = useClosingFirst(close, props.onCreateProfile);
  const editProfiles = useClosingFirst(close, props.onEditProfiles);
  const editProfile = useClosingFirst(close, props.onEditProfile);
  const reasoning = useMemo(
    () => ({
      modelName: labels.modelName,
      options: props.thinkingOptions,
      selectedId: props.selectedThinkingOptionId,
      onSelect: props.onSelectThinking,
    }),
    [
      labels.modelName,
      props.onSelectThinking,
      props.selectedThinkingOptionId,
      props.thinkingOptions,
    ],
  );
  return (
    <>
      <ModelChip
        ref={anchorRef}
        provider={props.provider}
        serverId={props.serverId}
        label={labels.chip}
        glyphSize={props.glyphSize}
        open={open}
        disabled={props.disabled}
        accessibilityLabel={labels.accessibility}
        keepName={props.isCompact}
        onPress={toggle}
      />
      {props.modeControl ? (
        <ModeDropdown
          {...props.modeControl}
          showLabel={props.showModeLabel}
          ownsCycleShortcut
          onClose={onClose}
          testID="mode-control"
        />
      ) : null}
      <ModelPicker
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        isCompact={props.isCompact}
        providers={props.providers}
        selectedProvider={props.provider}
        selectedModelId={props.selectedModelId}
        serverId={props.serverId}
        onPickModel={props.onPickModel}
        onPickModelWithEffort={pickModelWithEffort}
        reasoning={reasoning}
        speed={panelFeatures.speed}
        moreFeatures={panelFeatures.more}
        onSetFeature={props.onSetFeature}
        mode={props.modeControl}
        profiles={props.profiles}
        onCreateProfile={createProfile}
        onEditProfiles={editProfiles}
        onEditProfile={editProfile}
        onRefreshProvider={props.onRefreshProvider}
      />
    </>
  );
}

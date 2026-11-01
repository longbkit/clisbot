import { useCallback, useMemo, useRef, useState } from "react";
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
    accessibility: t("composer.picker.chip", { value: full }),
  };
}

/** The composer bar's two controls: the Model chip, which opens the panel, and Mode. */
export function ComposerPickerControls(props: ComposerPickerControlsProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const fullAutoAcceptSupported = useHostFeature(props.serverId, "fullAutoAccept");
  const labels = useChipLabels(props);
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
  const { onCreateProfile } = props;
  // The profile editor is a sheet of its own; it opens once the panel has closed.
  const createProfile = useMemo(
    () =>
      onCreateProfile
        ? (seed: AgentProfileSeed) => {
            handleOpenChange(false);
            onCreateProfile(seed);
          }
        : undefined,
    [handleOpenChange, onCreateProfile],
  );
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
        reasoning={reasoning}
        speed={panelFeatures.speed}
        moreFeatures={panelFeatures.more}
        onSetFeature={props.onSetFeature}
        mode={props.modeControl}
        profiles={props.profiles}
        onCreateProfile={createProfile}
        onRefreshProvider={props.onRefreshProvider}
      />
    </>
  );
}

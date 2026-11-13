import { useCallback, useMemo } from "react";
import type { AgentFeature, AgentMode, AgentProvider } from "@clisbot/protocol/agent-types";
import type { AgentProviderDefinition } from "@clisbot/protocol/provider-manifest";
import type { AgentModeControlValue } from "@/composer/agent-controls/mode-control";
import { useHostFeature } from "@/runtime/host-features";
import { COMPOSER_PICKER_ENABLED } from "./feature";
import {
  buildComposerModeOptions,
  isProviderAutoAcceptOn,
  PROVIDER_AUTO_ACCEPT_FEATURE_ID,
  resolveComposerModeId,
  shouldClearProviderAutoAccept,
} from "./mode-options";

/** Whether a draft's Mode list on this Host ends with Full auto-accept. */
export function useFullAutoAcceptOffered(serverId: string | null): boolean {
  return useHostFeature(serverId, "fullAutoAccept") && COMPOSER_PICKER_ENABLED;
}

/**
 * The modes a draft can be created with: the same list its Mode control shows. The submitted mode
 * is checked against this list, so a draft created in Full auto-accept keeps it.
 */
export function useDraftOfferedModes(serverId: string | null, modes: AgentMode[]): AgentMode[] {
  const fullAutoAcceptOffered = useFullAutoAcceptOffered(serverId);
  return useMemo(
    () => buildComposerModeOptions(modes, fullAutoAcceptOffered),
    [fullAutoAcceptOffered, modes],
  );
}

/**
 * A draft's Mode control. With the composer picker on and a Host that has Full auto-accept, the
 * list ends with Full auto-accept, and a draft carrying the provider's own `auto_accept` (a
 * saved preference; the picker hides that toggle) reads as Full auto-accept until another mode
 * turns it off. With the picker off it is the provider's own list, as upstream.
 */
export function useDraftModeControl(input: {
  selectedProvider: AgentProvider | null;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  features: AgentFeature[] | undefined;
  onSetFeature: ((featureId: string, value: unknown) => void) | undefined;
  disabled: boolean;
  serverId: string | null;
}): AgentModeControlValue | null {
  const { selectedProvider, providerDefinitions, modeOptions, selectedMode, disabled } = input;
  const { onSelectMode, onSetFeature } = input;
  const fullAutoAcceptSupported = useFullAutoAcceptOffered(input.serverId);
  const hiddenAutoAccept = fullAutoAcceptSupported && isProviderAutoAcceptOn(input.features);
  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (shouldClearProviderAutoAccept(modeId, hiddenAutoAccept)) {
        onSetFeature?.(PROVIDER_AUTO_ACCEPT_FEATURE_ID, false);
      }
      onSelectMode(modeId);
    },
    [hiddenAutoAccept, onSelectMode, onSetFeature],
  );
  return useMemo(
    () =>
      selectedProvider && modeOptions.length > 0
        ? {
            provider: selectedProvider,
            providerDefinitions,
            modeOptions: buildComposerModeOptions(modeOptions, fullAutoAcceptSupported),
            selectedModeId: resolveComposerModeId(selectedMode, false, hiddenAutoAccept),
            onSelectMode: handleSelectMode,
            disabled,
          }
        : null,
    [
      selectedProvider,
      providerDefinitions,
      modeOptions,
      fullAutoAcceptSupported,
      selectedMode,
      hiddenAutoAccept,
      handleSelectMode,
      disabled,
    ],
  );
}

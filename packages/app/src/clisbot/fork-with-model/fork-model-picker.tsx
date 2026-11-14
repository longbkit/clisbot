import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useWindowDimensions, type View } from "react-native";
import type { AgentProvider } from "@clisbot/protocol/agent-types";
import { ModelPicker } from "@/clisbot/composer-picker/model-picker";
import type { ReasoningProps } from "@/clisbot/composer-picker/use-reasoning-preview";
import type { ComboboxDesktopPlacement } from "@/components/ui/combobox";
import { ComposerPickerPlacementProvider } from "@/composer/picker-placement";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import type { ForkModelChoice } from "./feature";
import type { ForkModelSource } from "./source-context";

const NO_FEATURES: never[] = [];
// Effort, speed and mode are set in the fork's composer once the model is picked.
const NO_REASONING: ReasoningProps = {
  modelName: "",
  options: [],
  selectedId: undefined,
  onSelect() {},
};

// The composer picker's desktop panel height.
const PANEL_HEIGHT = 440;

function noop() {}

/**
 * Desktop popovers do not flip, and a fork button sits anywhere in the conversation: open the
 * panel downward when it fits below the button or there is more room below than above.
 */
function useForkPickerPlacement(
  anchorRef: RefObject<View | null>,
): ComboboxDesktopPlacement | null {
  const { height } = useWindowDimensions();
  const [placement, setPlacement] = useState<ComboboxDesktopPlacement | null>(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      setPlacement("top-start");
      return;
    }
    anchor.measureInWindow((_x, y, _width, anchorHeight) => {
      const below = height - (y + anchorHeight);
      setPlacement(below >= PANEL_HEIGHT || below >= y ? "bottom-start" : "top-start");
    });
  }, [anchorRef, height]);
  return placement;
}

/**
 * The composer picker's panel, anchored on the fork button, listing every provider on the
 * Host. Mount it only while open: it loads the Host's provider snapshot.
 */
export function ForkModelPicker({
  source,
  anchorRef,
  onPick,
  onClose,
}: {
  source: ForkModelSource;
  anchorRef: RefObject<View | null>;
  onPick: (choice: ForkModelChoice) => void;
  onClose: () => void;
}) {
  const isCompact = useIsCompactFormFactor();
  const placement = useForkPickerPlacement(anchorRef);
  const { entries, refresh } = useProvidersSnapshot(source.serverId, { cwd: source.cwd });
  const providers = useMemo(() => buildSelectableProviderSelectorProviders(entries), [entries]);
  const refreshProvider = useCallback(
    (provider: string) => refresh([provider as AgentProvider]),
    [refresh],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const handlePick = useCallback(
    (provider: string, modelId: string) => onPick({ provider, modelId }),
    [onPick],
  );
  if (!placement) return null;
  return (
    <ComposerPickerPlacementProvider value={placement}>
      <ModelPicker
        open
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        isCompact={isCompact}
        providers={providers}
        selectedProvider={source.provider}
        selectedModelId={source.modelId}
        serverId={source.serverId}
        onPickModel={handlePick}
        reasoning={NO_REASONING}
        speed={null}
        moreFeatures={NO_FEATURES}
        onSetFeature={noop}
        mode={null}
        profiles={null}
        onRefreshProvider={refreshProvider}
      />
    </ComposerPickerPlacementProvider>
  );
}

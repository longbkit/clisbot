import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, ListChecks, Lock, Pencil, ShieldOff, Sparkles } from "lucide-react-native";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import type { AgentControlIcon } from "@/agent-controls/icons";
import { formatAgentModeLabel } from "@/agent-controls/labels";
import {
  resolveModeConcept,
  resolveModeLabelKey,
  type ModeConcept,
  type ModeLabelKey,
} from "./mode-options";

const MODE_CONCEPT_ICONS: Record<ModeConcept, AgentControlIcon> = {
  ask: Lock,
  acceptEdits: Pencil,
  auto: Sparkles,
  bypass: ShieldOff,
  plan: ListChecks,
  fullAutoAccept: CheckCheck,
};

/**
 * Known native modes the app names with the common agent vocabulary (Plan mode, Edit mode, Auto
 * review, Full auto-accept) rather than the provider's own name; the provider's name stays
 * beside it so the fine differences remain readable. Clisbot's own Full auto-accept is not one
 * of them: it has no provider name.
 */
const SHARED_NAME_KEYS: ReadonlySet<ModeLabelKey> = new Set<ModeLabelKey>([
  "plan",
  "claudeAcceptEdits",
  "codexAutoReview",
  "claudeBypass",
  "codexFullAccess",
  "copilotAllowAll",
  "ompFull",
]);

function comparable(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * The provider's own name for a mode shown under a shared name, when it says something the shared
 * name does not ("Bypass permissions" under Full auto-accept, not "Plan" under Plan mode).
 */
export function resolveProviderModeName(
  key: ModeLabelKey | null,
  mode: { id: string; label?: string | null },
  displayLabel: string,
): string | undefined {
  if (!key || !SHARED_NAME_KEYS.has(key)) return undefined;
  const own = formatAgentModeLabel(mode);
  return comparable(displayLabel).includes(comparable(own)) ? undefined : own;
}

export interface ModePresentation {
  icon: AgentControlIcon;
  label: string;
  /** The provider's own name, when the label is the shared one and differs from it. */
  providerName: string | undefined;
  description: string | undefined;
}

/** A mode's icon, and its name and one-line description in the app's language when known. */
export function useModePresentation(): (provider: string, mode: AgentMode) => ModePresentation {
  const { t } = useTranslation();
  return useCallback(
    (provider, mode) => {
      const icon = MODE_CONCEPT_ICONS[resolveModeConcept(provider, mode)];
      const key = resolveModeLabelKey(provider, mode.id);
      if (!key)
        return {
          icon,
          label: formatAgentModeLabel(mode),
          providerName: undefined,
          description: mode.description,
        };
      const label = t(`composer.picker.modeLabels.${key}`);
      return {
        icon,
        label,
        providerName: resolveProviderModeName(key, mode, label),
        description: t(`composer.picker.modeDescriptions.${key}`),
      };
    },
    [t],
  );
}

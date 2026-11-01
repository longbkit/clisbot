import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, ListChecks, Lock, Pencil, ShieldOff, Sparkles } from "lucide-react-native";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import type { AgentControlIcon } from "@/agent-controls/icons";
import { formatAgentModeLabel } from "@/agent-controls/labels";
import { resolveModeConcept, resolveModeLabelKey, type ModeConcept } from "./mode-options";

const MODE_CONCEPT_ICONS: Record<ModeConcept, AgentControlIcon> = {
  ask: Lock,
  acceptEdits: Pencil,
  auto: Sparkles,
  bypass: ShieldOff,
  plan: ListChecks,
  fullAutoAccept: CheckCheck,
};

export interface ModePresentation {
  icon: AgentControlIcon;
  label: string;
  description: string | undefined;
}

/** A mode's icon, and its name and one-line description in the app's language when known. */
export function useModePresentation(): (provider: string, mode: AgentMode) => ModePresentation {
  const { t } = useTranslation();
  return useCallback(
    (provider, mode) => {
      const icon = MODE_CONCEPT_ICONS[resolveModeConcept(provider, mode)];
      const key = resolveModeLabelKey(provider, mode.id);
      if (!key) return { icon, label: formatAgentModeLabel(mode), description: mode.description };
      return {
        icon,
        label: t(`composer.picker.modeLabels.${key}`),
        description: t(`composer.picker.modeDescriptions.${key}`),
      };
    },
    [t],
  );
}

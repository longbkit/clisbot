import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import type { ComposerPickerResources } from "@/i18n/resources/composer-picker";

/**
 * Every provider's modes read as one of six concepts, so one icon means one thing across
 * providers: ask (lock), accept edits (pencil), auto (sparkles), bypass (shield off),
 * plan (checklist) and Clisbot's Full auto-accept (double check).
 */
export type ModeConcept = "plan" | "ask" | "acceptEdits" | "auto" | "bypass" | "fullAutoAccept";

export type ModeLabelKey = keyof ComposerPickerResources["modeLabels"];

const COPILOT_MODES = "https://agentclientprotocol.com/protocol/session-modes#";

/** Known `provider:modeId` pairs: their concept and the app's translated label key. */
const KNOWN_MODES: Record<string, { concept: ModeConcept; labelKey: ModeLabelKey }> = {
  "claude:default": { concept: "ask", labelKey: "claudeDefault" },
  "claude:acceptEdits": { concept: "acceptEdits", labelKey: "claudeAcceptEdits" },
  "claude:auto": { concept: "auto", labelKey: "claudeAuto" },
  "claude:bypassPermissions": { concept: "bypass", labelKey: "claudeBypass" },
  "codex:auto": { concept: "ask", labelKey: "codexDefault" },
  "codex:auto-review": { concept: "auto", labelKey: "codexAutoReview" },
  "codex:full-access": { concept: "bypass", labelKey: "codexFullAccess" },
  [`copilot:${COPILOT_MODES}agent`]: { concept: "ask", labelKey: "copilotAgent" },
  "copilot:allow-all": { concept: "bypass", labelKey: "copilotAllowAll" },
  "opencode:build": { concept: "ask", labelKey: "opencodeBuild" },
  "omp:full": { concept: "bypass", labelKey: "ompFull" },
  "omp:write": { concept: "ask", labelKey: "ompWrite" },
  "omp:ask": { concept: "ask", labelKey: "ompAsk" },
};

function isPlanMode(mode: AgentMode): boolean {
  return mode.id === "plan" || mode.id.endsWith("#plan") || mode.colorTier === "planning";
}

export function resolveModeConcept(provider: string, mode: AgentMode): ModeConcept {
  if (mode.id === FULL_AUTO_ACCEPT_MODE_ID) return "fullAutoAccept";
  if (isPlanMode(mode)) return "plan";
  const known = KNOWN_MODES[`${provider}:${mode.id}`];
  if (known) return known.concept;
  if (mode.colorTier === "dangerous") return "bypass";
  return "ask";
}

/** The `composer.picker.modeLabels` key for a mode the app names itself, else null. */
export function resolveModeLabelKey(provider: string, modeId: string): ModeLabelKey | null {
  if (modeId === FULL_AUTO_ACCEPT_MODE_ID) return "fullAutoAccept";
  if (modeId === "plan" || modeId === `${COPILOT_MODES}plan`) return "plan";
  return KNOWN_MODES[`${provider}:${modeId}`]?.labelKey ?? null;
}

/** The provider's modes, then Full auto-accept when the Host offers it. */
export function buildComposerModeOptions(
  modes: readonly AgentMode[],
  fullAutoAcceptSupported: boolean,
): AgentMode[] {
  if (!fullAutoAcceptSupported || modes.length === 0) return [...modes];
  const own = modes.filter((mode) => mode.id !== FULL_AUTO_ACCEPT_MODE_ID);
  return [...own, { id: FULL_AUTO_ACCEPT_MODE_ID, label: "Full auto-accept" }];
}

/** While Full auto-accept is on the daemon reports the provider mode under it. */
export function resolveComposerModeId(
  currentModeId: string | null | undefined,
  fullAutoAccept: boolean | undefined,
): string | null {
  return fullAutoAccept ? FULL_AUTO_ACCEPT_MODE_ID : (currentModeId ?? null);
}

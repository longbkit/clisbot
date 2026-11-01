import type { AgentProviderModeDefinition } from "@clisbot/protocol/provider-manifest";
import type { AgentMode, AgentStreamEvent } from "./agent-sdk-types.js";

/**
 * Providers report bare runtime modes (Codex's permission presets, ACP `session/new` modes).
 * The provider manifest owns what the app and the daemon read from a mode: its icon, its colour
 * tier and whether it runs without prompts (`isUnattended`, which Full auto-accept and Managed
 * Access rely on). Every mode list entering the daemon passes through here, for every provider,
 * so no consumer has to know which provider forgot which field. What a provider sets itself wins.
 */
export function normalizeProviderModes(
  modes: readonly AgentMode[],
  definitionModes: readonly AgentProviderModeDefinition[],
): AgentMode[] {
  return modes.map((mode) => {
    const definition = definitionModes.find((entry) => entry.id === mode.id);
    if (!definition) return mode;
    return {
      ...mode,
      icon: mode.icon ?? definition.icon,
      colorTier: mode.colorTier ?? definition.colorTier,
      ...(mode.isUnattended === undefined && definition.isUnattended ? { isUnattended: true } : {}),
    };
  });
}

export function normalizeProviderModesEvent(
  event: AgentStreamEvent,
  definitionModes: readonly AgentProviderModeDefinition[],
): AgentStreamEvent {
  if (event.type !== "mode_changed") return event;
  return {
    ...event,
    availableModes: normalizeProviderModes(event.availableModes, definitionModes),
  };
}

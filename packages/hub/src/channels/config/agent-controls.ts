// A Route's default Agent controls (`agentControls:`): provider, model, mode,
// thinking option and feature values layered over the named `hub.yml` agent the
// Route targets. It is how `/promoteroutedefault` changes what one Route starts
// without editing an agent other Routes and Automations share.
//
// The leaf is not part of the Route target. A binding keeps its session while
// the target is unchanged, so changing a default leaves running sessions alone
// and only the next session on the Route uses it.

import { z } from "zod";
import { AgentSchema, type CompiledAgent } from "../../config/compiler.js";

export const AgentControlsSchema = AgentSchema.omit({ options: true }).partial().strict();
export type AgentControls = z.infer<typeof AgentControlsSchema>;

/**
 * The agent a Route starts. A different provider replaces every
 * provider-specific value, because a model, mode or option id means nothing
 * under another provider. The same provider (or none named) overrides field by
 * field.
 */
export function applyAgentControls(
  agent: CompiledAgent,
  controls: AgentControls | undefined,
): CompiledAgent {
  if (controls === undefined) return agent;
  if (controls.provider !== undefined && controls.provider !== agent.provider) {
    return { ...controls, provider: controls.provider };
  }
  return { ...agent, ...controls, provider: agent.provider };
}

/** Two control sets name the same agent configuration. */
export function sameAgentControls(left: AgentControls, right: AgentControls): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>)
            .filter(([, field]) => field !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
}

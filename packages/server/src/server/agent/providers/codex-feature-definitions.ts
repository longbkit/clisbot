import type { AgentFeature } from "../agent-sdk-types.js";

import { z } from "zod";

export const CodexServiceTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

function buildCodexSpeedFeature(tiers: CodexServiceTier[], value: string): AgentFeature[] {
  if (tiers.length === 0) return [];
  return [
    {
      type: "select",
      id: "service_tier",
      label: "Speed",
      description: "Choose processing speed. Faster tiers increase usage.",
      tooltip: "Select speed",
      icon: "zap",
      desktopTrigger: "icon",
      value,
      options: [
        { id: "default", label: "Normal", isDefault: true },
        ...tiers.map((tier) => ({ id: tier.id, label: tier.name })),
      ],
    },
  ];
}

// Plan is a Codex mode, not a feature; see CODEX_PLAN_MODE in codex-app-server-agent.ts.
export function buildCodexFeatures(input: {
  serviceTiers: CodexServiceTier[];
  serviceTier: string;
}): AgentFeature[] {
  return buildCodexSpeedFeature(input.serviceTiers, input.serviceTier);
}

export function readCodexServiceTier(values: Record<string, unknown> | undefined): string | null {
  const tier = values?.service_tier;
  if (typeof tier === "string") return tier;
  // COMPAT(codexFastPreference): added in v0.10.0, remove after 2027-03-29 once saved Fast preferences have migrated.
  return values?.fast_mode ? "fast" : null;
}

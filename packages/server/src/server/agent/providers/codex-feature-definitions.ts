import type { AgentOptionControl } from "../agent-sdk-types.js";

import { z } from "zod";

export const CodexServiceTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

// Newer Codex versions accept Flex as a request option without advertising it per model.
const CODEX_FLEX_SERVICE_TIER: CodexServiceTier = {
  id: "flex",
  name: "Flex",
  description: "Slower processing, reduced usage",
};

export function codexSpeedTiers(
  catalogTiers: CodexServiceTier[],
  supportsUnadvertisedFlex: boolean,
): CodexServiceTier[] {
  if (
    !supportsUnadvertisedFlex ||
    catalogTiers.some((tier) => tier.id === CODEX_FLEX_SERVICE_TIER.id)
  ) {
    return catalogTiers;
  }
  return [CODEX_FLEX_SERVICE_TIER, ...catalogTiers];
}

function buildCodexSpeedControl(tiers: CodexServiceTier[]): AgentOptionControl[] {
  if (tiers.length === 0) return [];
  return [
    {
      type: "select",
      key: "service_tier",
      label: "Speed",
      description: "Choose processing speed. Faster tiers increase usage.",
      tooltip: "Select speed",
      icon: "zap",
      desktopTrigger: "icon",
      defaultValue: "default",
      choices: [
        { value: "default", label: "Normal" },
        ...tiers.map((tier) => ({ value: tier.id, label: tier.name })),
      ],
    },
  ];
}

// Plan is a Codex mode, not a control; see CODEX_PLAN_MODE in codex-app-server-agent.ts.
export function buildCodexControls(input: {
  serviceTiers: CodexServiceTier[];
}): AgentOptionControl[] {
  return buildCodexSpeedControl(input.serviceTiers);
}

export function readCodexServiceTier(options: Record<string, unknown> | undefined): string | null {
  const tier = options?.service_tier;
  return typeof tier === "string" ? tier : null;
}

import { runAcpProvider } from "@clisbot/plugin/server/acp";
import type { ProviderRegistration } from "@clisbot/plugin/server/provider";
import { runPhaseTransformer } from "./run-phase.js";

export function createHopliteProvider(): ProviderRegistration {
  return {
    requiresConfiguration: true,
    ...runAcpProvider({
      id: "hoplite",
      label: "Hoplite",
      description: "Hoplite's coding agent through the local `hoplite acp` bridge",
      icon: "icon.svg",
      command: ["hoplite", "acp"],
      acpOptions: { workspaceOnlyCatalog: true },
      transformers: [runPhaseTransformer],
    }),
  };
}

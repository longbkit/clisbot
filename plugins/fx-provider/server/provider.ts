import { runAcpProvider } from "@clisbot/plugin/server/acp";
import type { ProviderRegistration } from "@clisbot/plugin/server/provider";
import { fileToolTransformer } from "./file-tools.js";

export function createFxProvider(): ProviderRegistration {
  return {
    requiresConfiguration: true,
    ...runAcpProvider({
      id: "fx",
      label: "fx",
      description: "Vercel Labs' native coding agent through `fx acp`",
      icon: "icon.svg",
      command: ["fx", "acp"],
      transformers: [fileToolTransformer],
    }),
    docsUrl: "https://clisbot.com/docs/supported-providers/fx",
  };
}

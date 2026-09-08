import type { DaemonConnection } from "./client.js";

/** Catalog/control defaults for existing channel test doubles. Tests override the operations they exercise. */
export function configurationDaemonStub(): Pick<
  DaemonConnection,
  | "getServerInfo"
  | "listAvailableProviders"
  | "listProviderModels"
  | "listProviderModes"
  | "listAgentProfiles"
  | "listCommands"
  | "setAgentModel"
  | "setAgentThinkingOption"
  | "setAgentMode"
  | "applyAgentConfig"
  | "buildAgentForkContext"
  | "isAgentInProject"
> {
  return {
    getServerInfo: () => ({
      serverId: "test-daemon",
      features: { agentConfigApply: true, agentForkContext: true },
    }),
    listAvailableProviders: async () => [
      { provider: "codex", available: true },
      { provider: "claude", available: true },
    ],
    listProviderModels: async (provider) => [
      { provider, id: "default", label: "Default", isDefault: true },
    ],
    listProviderModes: async () => [{ id: "default", label: "Default", isUnattended: false }],
    isAgentInProject: async () => false,
    listAgentProfiles: async () => [],
    listCommands: async () => [],
    setAgentModel: async () => undefined,
    setAgentThinkingOption: async () => undefined,
    setAgentMode: async () => undefined,
    applyAgentConfig: async () => undefined,
    buildAgentForkContext: async () => ({
      attachment: {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        text: "Prior conversation",
      },
      itemCount: 1,
    }),
  };
}

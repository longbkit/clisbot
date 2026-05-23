import { resolveZaloPersonalConfig } from "./config.ts";
import type { ChannelOperatorInventory } from "../integration/operator-inventory.ts";
import {
  countConfiguredBotDirectMessageSurfaces,
  countConfiguredBotGroupSurfaces,
  deriveConfiguredChannelConnection,
  resolveRuntimeSummaryDefaultBot,
  resolveRuntimeSummaryDirectMessageConfig,
} from "../integration/operator-inventory.ts";

export const zaloPersonalChannelOperatorInventory: ChannelOperatorInventory = {
  runtimeSummary: {
    order: 40,
    buildInput: ({ loadedConfig, runtimeRunning, activities, runtimeHealth }) => {
      const enabled = loadedConfig.raw.bots.zaloPersonal.defaults.enabled;
      const defaultBot = resolveRuntimeSummaryDefaultBot({
        providerConfig: loadedConfig.raw.bots.zaloPersonal,
        resolveBotConfig: (botId) => resolveZaloPersonalConfig(loadedConfig.raw.bots.zaloPersonal, botId),
      });
      const defaultDmConfig = resolveRuntimeSummaryDirectMessageConfig(defaultBot);
      return {
        channel: "zalo-personal",
        enabled,
        connection: deriveConfiguredChannelConnection({
          enabled,
          runtimeRunning,
          recordedConnection: runtimeHealth.channels["zalo-personal"]?.connection,
        }),
        defaultAgentId:
          defaultBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
        streaming: defaultBot.streaming,
        response: defaultBot.response,
        responseMode: defaultBot.responseMode,
        additionalMessageMode: defaultBot.additionalMessageMode,
        configuredSurfaceCount:
          countConfiguredBotDirectMessageSurfaces(loadedConfig.raw.bots.zaloPersonal) +
          countConfiguredBotGroupSurfaces(loadedConfig.raw.bots.zaloPersonal),
        directMessagesEnabled: defaultDmConfig?.enabled !== false,
        directMessagesPolicy: defaultDmConfig?.policy ?? "disabled",
        activity: activities.channels["zalo-personal"],
        health: runtimeHealth.channels["zalo-personal"],
      };
    },
  },
};

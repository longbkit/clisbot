import type { AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type { ParsedMessageCommand, ResolvedMessageSurface } from "../message/message-command.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { ChannelResultStore } from "../results/result-store.ts";
import { resolveApiBotConfig, resolveApiBotId, resolveApiProviderConfig } from "./config.ts";
import { sendApiMessage } from "./message-actions.ts";
import { resolveApiConversationRoute } from "./route-config.ts";
import { resolveApiConversationTarget } from "./session-routing.ts";
import { ApiChannelService, isApiChannelEnabled } from "./service.ts";
import { buildApiPromptSurface, resolveApiSurface } from "./surface.ts";

function resolveApiReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  surface: ResolvedMessageSurface | null;
  botId: string;
}): AgentSessionTarget | null {
  const surface = resolveApiSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
    surface: params.surface?.channel === "api" ? params.surface : null,
  });
  if (!surface) {
    return null;
  }
  const resolved = resolveApiConversationRoute({
    loadedConfig: params.loadedConfig,
    botId: params.botId,
    surfaceKind: surface.provider.surfaceKind,
    surfaceId: surface.provider.surfaceId,
  });
  if (!resolved.route) {
    return null;
  }
  return resolveApiConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: resolved.route.agentId,
    botId: params.botId,
    surfaceKind: surface.provider.surfaceKind,
    surfaceId: surface.provider.surfaceId,
  });
}

const apiChannelPlugin: ChannelPlugin = {
  id: "api",
  displayName: "API",
  interactionRenderer: "plain",
  senderPrincipalExample: "api:chatwoot:user-123",
  agentReply: {
    inputFormat: "md",
    renderMode: "native",
    styleHint: "Put readable hierarchical Markdown in the --message body when the API bot native render mode is markdown.",
    resolveTarget: (identity) => {
      const kind = identity.conversationKind === "dm" ? "dm" : "group";
      const surfaceId = identity.chatId ?? identity.channelId;
      return surfaceId ? `${kind}:${surfaceId}` : null;
    },
  },
  capabilities: {
    surfaceKinds: ["dm", "group"],
    messageActions: ["send"],
  },
  isEnabled: isApiChannelEnabled,
  listBots: (loadedConfig) => {
    const apiConfig = resolveApiProviderConfig(loadedConfig.raw.bots.api);
    return isApiChannelEnabled(loadedConfig)
      ? [{ botId: "listener", config: apiConfig.defaults.listener }]
      : [];
  },
  createRuntimeService: (context) =>
    new ApiChannelService({
      loadedConfig: context.loadedConfig,
      agentService: context.agentService,
    }),
  renderHealthSummary: (state) => {
    if (state === "disabled") {
      return "API channel is disabled.";
    }
    if (state === "stopped") {
      return "API channel is stopped.";
    }
    return "API channel is starting.";
  },
  renderActiveHealthSummary: () => "API channel listener is active.",
  buildPromptSurface: buildApiPromptSurface,
  runMessageCommand: async (loadedConfig, command, _surface) => {
    const botId = resolveApiBotId(loadedConfig.raw.bots.api, command.account);
    resolveApiBotConfig(loadedConfig.raw.bots.api, botId);
    return {
      botId,
      result: await sendApiMessage({
        loadedConfig,
        command,
        botId,
        resultStore: new ChannelResultStore(),
      }),
    };
  },
  resolveMessageSurface: (command) =>
    resolveApiSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
    }),
  resolveMessageReplyTarget: resolveApiReplyTarget,
  controlHelp: {
    message: {
      targetLines: [
        "API accepts `dm:<surface-id>` or `group:<surface-id>`.",
        "  Use `--reply-to <eventId>` to write progress/final to a specific event result.",
      ],
      renderLines: [
        "  - API native: maps to the API bot action rendering.native value",
        "  - first slice stores text or markdown result output only",
      ],
      exampleLines: [
        `  ${renderCliCommand("message send --channel api --bot chatwoot --target dm:3:970 --reply-to message-created-123 --final --message \"Done\"")}`,
      ],
    },
    routes: {
      addSyntaxLines: [
        `  ${renderCliCommand("routes add --channel api dm:<surface-id> [--bot <id>] [--policy <...>]")}`,
      ],
      exampleLines: [
        `  ${renderCliCommand("routes add --channel api dm:* --bot chatwoot --policy open")}`,
      ],
    },
  },
};

export default apiChannelPlugin;

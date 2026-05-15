import { defineChannelTemplateContract } from "../../config/channels/channel-template-defaults.ts";

function createZaloBotProviderDefaultsTemplate(params: {
  enabled: boolean;
  extra?: Record<string, unknown>;
}) {
  return {
    enabled: params.enabled,
    defaultBotId: "default",
    mode: "polling",
    allowBots: false,
    dmPolicy: "pairing",
    agentPrompt: {
      enabled: true,
      maxProgressMessages: 3,
      requireFinalResponse: true,
    },
    directMessages: {
      "*": {
        enabled: true,
        requireMention: false,
        policy: "pairing",
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    },
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    surfaceNotifications: {
      queueStart: "brief",
      loopStart: "brief",
    },
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
    },
    ...params.extra,
  };
}

const zaloBotChannelTemplateContract = defineChannelTemplateContract({
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  buildTemplate: ({ options, renderEnvReference }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createZaloBotProviderDefaultsTemplate({
        enabled,
        extra: {
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
        },
      }),
      default: {
        enabled,
        name: "default",
        dmPolicy: "pairing",
        directMessages: {},
        botToken: renderEnvReference("ZALO_BOT_TOKEN", options.botTokenRef),
      },
    } as any;
  },
});

export default zaloBotChannelTemplateContract;

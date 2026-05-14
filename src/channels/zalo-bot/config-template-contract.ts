import {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";

const zaloBotChannelTemplateContract = defineChannelTemplateContract({
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  buildTemplate: ({ options, renderEnvReference }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createStandardChannelProviderDefaultsTemplate({
        enabled,
        mode: "polling",
        extra: {
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
        },
      }),
      default: createChannelDefaultBotTemplate({
        enabled,
        extra: {
          botToken: renderEnvReference("ZALO_BOT_TOKEN", options.botTokenRef),
        },
      }),
    };
  },
});

export default zaloBotChannelTemplateContract;

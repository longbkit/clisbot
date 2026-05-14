import {
  createChannelDefaultBotTemplate,
  createTopicChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";

const telegramChannelTemplateContract = defineChannelTemplateContract({
  channel: "telegram",
  configBotKey: "telegram",
  buildTemplate: ({ options, renderEnvReference }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createTopicChannelProviderDefaultsTemplate({
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
          botToken: renderEnvReference("TELEGRAM_BOT_TOKEN", options.botTokenRef),
        },
      }),
    };
  },
});

export default telegramChannelTemplateContract;

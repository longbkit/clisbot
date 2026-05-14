import {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";

const slackChannelTemplateContract = defineChannelTemplateContract({
  channel: "slack",
  configBotKey: "slack",
  buildTemplate: ({ options, renderEnvReference }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createStandardChannelProviderDefaultsTemplate({
        enabled,
        mode: "socket",
        extra: {
          channelPolicy: "allowlist",
          ackReaction: "",
          typingReaction: "",
          replyToMode: "thread",
          processingStatus: {
            enabled: true,
            status: "Working...",
            loadingMessages: [],
          },
        },
      }),
      default: createChannelDefaultBotTemplate({
        enabled,
        extra: {
          appToken: renderEnvReference("SLACK_APP_TOKEN", options.appTokenRef),
          botToken: renderEnvReference("SLACK_BOT_TOKEN", options.botTokenRef),
          channelPolicy: "allowlist",
        },
      }),
    };
  },
});

export default slackChannelTemplateContract;

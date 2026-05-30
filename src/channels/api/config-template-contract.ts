import {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";

const apiChannelTemplateContract = defineChannelTemplateContract({
  channel: "api",
  configBotKey: "api",
  buildTemplate: ({ options }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createStandardChannelProviderDefaultsTemplate({
        enabled,
        mode: "listener",
        extra: {
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
          directMessages: {},
          groups: {
            "*": {
              enabled: true,
              requireMention: false,
              policy: "open",
              allowUsers: [],
              blockUsers: [],
              allowBots: false,
            },
          },
          listener: {
            host: "127.0.0.1",
            port: 6868,
          },
        },
      }),
      default: createChannelDefaultBotTemplate({
        enabled: false,
        extra: {
          directMessages: {},
          groups: {},
          ingress: {
            auth: {
              mode: "none",
            },
            map: {
              eventId: "$.id",
              surfaceKind: "dm",
              surfaceId: "$.surfaceId",
              senderId: "$.senderId",
              text: "$.text",
            },
          },
          actions: {},
        },
      }),
    };
  },
});

export default apiChannelTemplateContract;

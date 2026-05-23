import {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";
import { buildDefaultZaloPersonalTokenFile } from "./session-path.ts";

const zaloPersonalChannelTemplateContract = defineChannelTemplateContract({
  channel: "zalo-personal",
  configBotKey: "zaloPersonal",
  buildTemplate: ({ options }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createStandardChannelProviderDefaultsTemplate({
        enabled,
        mode: "listener",
        extra: {
          dmPolicy: "disabled",
          directMessages: {},
          followUp: {
            mode: "mention-only",
          },
        },
      }),
      default: createChannelDefaultBotTemplate({
        enabled,
        extra: {
          credentialType: "tokenFile",
          dmPolicy: "disabled",
          tokenFile: buildDefaultZaloPersonalTokenFile("default"),
          followUp: {
            mode: "mention-only",
          },
        },
      }),
    };
  },
});

export default zaloPersonalChannelTemplateContract;

import type { RuntimeChannel } from "../control/runtime-health-store.ts";
import type { ChannelPlugin } from "./channel-plugin.ts";
import { slackChannelPlugin } from "./slack/plugin.ts";
import { telegramChannelPlugin } from "./telegram/plugin.ts";
import { zaloBotChannelPlugin } from "./zalo-bot/plugin.ts";

const CHANNEL_PLUGINS: ChannelPlugin[] = [
  slackChannelPlugin,
  telegramChannelPlugin,
  zaloBotChannelPlugin,
];

export function listChannelPlugins() {
  return [...CHANNEL_PLUGINS];
}

export function getChannelPlugin(channel: RuntimeChannel) {
  return CHANNEL_PLUGINS.find((plugin) => plugin.id === channel);
}

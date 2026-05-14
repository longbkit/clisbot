import type { BotRouteConfig } from "../core/schema.ts";
import type { ChannelGroupRoute } from "./channel-config-shapes.ts";

export function createStandardChannelGroupRouteShell(
  policy: BotRouteConfig["policy"] = "open",
): BotRouteConfig {
  return {
    enabled: policy !== "disabled",
    requireMention: true,
    policy,
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  } satisfies BotRouteConfig;
}

export function createTopicAwareChannelGroupRouteShell(
  policy: BotRouteConfig["policy"] = "open",
): ChannelGroupRoute {
  return {
    ...createStandardChannelGroupRouteShell(policy),
    topics: {},
  };
}

export function createTopicChannelRouteShell(
  base?: Pick<BotRouteConfig, "enabled" | "requireMention" | "allowBots">,
) {
  return {
    enabled: base?.enabled ?? true,
    requireMention: base?.requireMention ?? true,
    allowBots: base?.allowBots ?? false,
    allowUsers: [],
    blockUsers: [],
  } satisfies BotRouteConfig;
}

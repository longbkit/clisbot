import { renderCliCommand } from "./cli-name.ts";
import {
  channelSupportsRouteGroups,
  renderCanonicalRouteIdList,
  renderChannelRouteIdSyntax,
  renderLegacyCompatibleRouteInputList,
} from "../../channels/integration/channel-surface-contract-registry.ts";
import {
  getChannelPlugin,
  listChannelPlugins,
  renderChannelNamePlaceholder,
  renderSupportedChannelsNote,
} from "../../channels/catalog/registry.ts";
import type { MessageChannel } from "../../channels/message/message-command.ts";

function renderRouteAddSyntaxLines(channel?: MessageChannel) {
  return channel
    ? getChannelPlugin(channel)?.controlHelp?.routes?.addSyntaxLines ?? []
    : listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.routes?.addSyntaxLines ?? []);
}

function renderRouteExampleLines(channel?: MessageChannel) {
  return channel
    ? getChannelPlugin(channel)?.controlHelp?.routes?.exampleLines ?? []
    : listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.routes?.exampleLines ?? []);
}

export function renderRoutesHelp(channel?: MessageChannel) {
  const channelName = renderChannelNamePlaceholder();
  const showGroupRoutes = !channel || channelSupportsRouteGroups(channel);
  const legacyCompatibleRouteInputList = renderLegacyCompatibleRouteInputList(channel);
  return [
    renderCliCommand("routes"),
    "",
    "Usage:",
    `  ${renderCliCommand("routes --help")}`,
    `  ${renderCliCommand("routes help")}`,
    `  ${renderCliCommand(`routes list [--channel ${channelName}] [--bot <id>] [--json]`)}`,
    `  ${renderCliCommand(`routes add --channel ${channelName} <dm:*|dm:<id>> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`)}`,
    ...(showGroupRoutes
      ? [`  ${renderCliCommand(`routes add --channel ${channelName} group:* [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`)}`]
      : []),
    ...renderRouteAddSyntaxLines(channel),
    `  ${renderCliCommand(`routes get --channel ${channelName} <route-id> [--bot <id>] [--json]`)}`,
    `  ${renderCliCommand(`routes enable --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes disable --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes remove --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes get-agent --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-agent --channel ${channelName} <route-id> [--bot <id>] --agent <id>`)}`,
    `  ${renderCliCommand(`routes clear-agent --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes get-policy --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-policy --channel ${channelName} <route-id> [--bot <id>] --policy <...>`)}`,
    `  ${renderCliCommand(`routes clear-policy --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes get-require-mention --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-require-mention --channel ${channelName} <route-id> [--bot <id>] --value <true|false>`)}`,
    `  ${renderCliCommand(`routes get-allow-bots --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-allow-bots --channel ${channelName} <route-id> [--bot <id>] --value <true|false>`)}`,
    `  ${renderCliCommand(`routes add-allow-user --channel ${channelName} <route-id> [--bot <id>] --user <principal>`)}`,
    `  ${renderCliCommand(`routes remove-allow-user --channel ${channelName} <route-id> [--bot <id>] --user <principal>`)}`,
    `  ${renderCliCommand(`routes add-block-user --channel ${channelName} <route-id> [--bot <id>] --user <principal>`)}`,
    `  ${renderCliCommand(`routes remove-block-user --channel ${channelName} <route-id> [--bot <id>] --user <principal>`)}`,
    `  ${renderCliCommand(`routes get-follow-up-mode --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-follow-up-mode --channel ${channelName} <route-id> [--bot <id>] --mode <auto|mention-only|paused>`)}`,
    `  ${renderCliCommand(`routes get-follow-up-ttl --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-follow-up-ttl --channel ${channelName} <route-id> [--bot <id>] --minutes <n>`)}`,
    `  ${renderCliCommand(`routes get-response-mode --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-response-mode --channel ${channelName} <route-id> [--bot <id>] --mode <capture-pane|message-tool>`)}`,
    `  ${renderCliCommand(`routes clear-response-mode --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes get-additional-message-mode --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-additional-message-mode --channel ${channelName} <route-id> [--bot <id>] --mode <queue|steer>`)}`,
    `  ${renderCliCommand(`routes clear-additional-message-mode --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes get-timezone --channel ${channelName} <route-id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`routes set-timezone --channel ${channelName} <route-id> [--bot <id>] <iana-timezone>`)}`,
    `  ${renderCliCommand(`routes clear-timezone --channel ${channelName} <route-id> [--bot <id>]`)}`,
    "",
    "Notes:",
    channel
      ? `  - Channel route ids for ${channel} use ${renderChannelRouteIdSyntax(channel)}.`
      : `  - Canonical CLI ids are ${renderCanonicalRouteIdList()}.`,
    "  - Inside bot config, canonical stored keys are raw ids plus `*`.",
    ...(legacyCompatibleRouteInputList
      ? [`  - Backward-compatible input still accepts legacy ids such as ${legacyCompatibleRouteInputList}.`]
      : []),
    ...(showGroupRoutes ? ["  - Shared group policy values are `disabled`, `allowlist`, and `open`."] : []),
    "  - DM wildcard policy values are `disabled`, `pairing`, `allowlist`, and `open`.",
    `  - ${renderSupportedChannelsNote()}`,
    `  - use ${renderCliCommand(`routes --help --channel ${channelName}`)} for channel-specific route syntax and examples`,
    "  - `pairing approve <channel> <code>` writes the approved sender into the requesting bot's `dm:*` allowUsers.",
    ...(showGroupRoutes
      ? [
          "  - the provider's shared multi-user admission policy controls which groups/channels/topics are admitted; `group:*` controls the default sender policy inside admitted multi-user surfaces.",
          "  - With default group admission `allowlist`, adding `group:<id>` makes that group usable immediately by inheriting `group:*` sender policy.",
        ]
      : ["  - This channel does not support shared group routes."]),
    "  - `routes add` can set `--policy`, `--require-mention`, and `--allow-bots` in the same command.",
    ...(showGroupRoutes ? ["  - Use `group:*` with `add-allow-user` when one user should be allowed in every admitted group under that bot."] : []),
    "  - `policy: disabled` means fully silent on that surface, including owner/admin and pairing guidance.",
    ...(showGroupRoutes
      ? [
          "  - In enabled multi-user surfaces, owner/admin bypass allowlist by default, but `blockUsers` still wins.",
          "  - If a sender is not in `allowUsers` on a multi-user route, the bot replies: `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to `allowUsers` for this surface.`",
        ]
      : []),
    "  - Use `bots set-agent ...` when the whole bot should change fallback agent; use `routes set-agent ...` only when one route needs a different agent.",
    "  - Use route timezone only when one routed surface needs different wall-clock time from the app or agent default.",
    "  - `routes get-timezone` prints the route override, effective timezone, and current local time for that surface.",
    "",
    "Examples:",
    ...renderRouteExampleLines(channel),
  ].join("\n");
}

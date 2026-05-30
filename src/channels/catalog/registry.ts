import {
  renderDefaultChannelLabel,
  type ChannelId,
  type ChannelInteractionRenderer,
} from "../integration/channel-surface-contract.ts";
import { normalizeChannelUserId } from "../integration/channel-surface-contract-registry.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type {
  ChannelRuntimeSummaryBuilder,
  ChannelStartupDescriptor,
} from "../integration/operator-inventory.ts";
import apiChannelPlugin from "../api/plugin.ts";
import slackChannelPlugin from "../slack/plugin.ts";
import telegramChannelPlugin from "../telegram/plugin.ts";
import zaloBotChannelPlugin from "../zalo-bot/plugin.ts";
import zaloPersonalChannelPlugin from "../zalo-personal/plugin.ts";

export const CHANNEL_NAME_PLACEHOLDER = "<channel-name>";
export const CHANNEL_PLUGINS = [
  apiChannelPlugin,
  slackChannelPlugin,
  telegramChannelPlugin,
  zaloBotChannelPlugin,
  zaloPersonalChannelPlugin,
] as const satisfies readonly ChannelPlugin[];

export function listChannelPlugins() {
  return [...CHANNEL_PLUGINS];
}

export function getChannelPlugin(channel: ChannelId) {
  return CHANNEL_PLUGINS.find((plugin) => plugin.id === channel);
}

export function requireChannelPlugin(channel: ChannelId) {
  const plugin = getChannelPlugin(channel);
  if (!plugin) {
    throw new Error(`Unsupported channel plugin: ${channel}`);
  }
  return plugin;
}

export function listRegisteredChannelIds(): ChannelId[] {
  return CHANNEL_PLUGINS.map((plugin) => plugin.id);
}

export function isRegisteredChannelId(value: string): value is ChannelId {
  return CHANNEL_PLUGINS.some((plugin) => plugin.id === value);
}

export function renderChannelLabel(channel: ChannelId) {
  return getChannelPlugin(channel)?.displayName ?? renderDefaultChannelLabel(channel);
}

export function buildChannelDefaultDirectMessageTarget(
  channel: ChannelId,
  providerUserId: string,
) {
  const plugin = getChannelPlugin(channel);
  if (plugin?.buildDefaultDirectMessageTarget) {
    return plugin.buildDefaultDirectMessageTarget(providerUserId);
  }
  return normalizeChannelUserId(channel, providerUserId);
}

export function resolveChannelInteractionRenderer(
  channel: ChannelId,
): ChannelInteractionRenderer {
  const interactionRenderer = requireChannelPlugin(channel).interactionRenderer;
  if (!interactionRenderer) {
    throw new Error(`Channel plugin ${channel} is missing an interaction renderer.`);
  }
  return interactionRenderer;
}

export function buildChannelPromptSurface(identity: ChannelIdentity) {
  return getChannelPlugin(identity.platform)?.buildPromptSurface?.(identity);
}

export function renderChannelNamePlaceholder() {
  return CHANNEL_NAME_PLACEHOLDER;
}

export function renderSupportedChannelsNote(label = "Supported channels") {
  return `${label}: ${listRegisteredChannelIds().join(", ")}.`;
}

export function listChannelSenderPrincipalExamples(channels?: ChannelId[]) {
  const allowed = channels ? new Set(channels) : undefined;
  return CHANNEL_PLUGINS
    .filter((plugin) => !allowed || allowed.has(plugin.id))
    .map((plugin) => plugin.senderPrincipalExample?.trim())
    .filter((example): example is string => Boolean(example));
}

export function renderSenderPrincipalExamples(channels?: ChannelId[]) {
  return listChannelSenderPrincipalExamples(channels).join(", ");
}

export function renderChannelRequirementMessage(flagName = "--channel") {
  return `${flagName} ${renderChannelNamePlaceholder()} is required. ${renderSupportedChannelsNote()}`;
}

export function parseRegisteredChannelOrThrow(
  raw: string | undefined,
  flagName = "--channel",
): ChannelId {
  const value = raw?.trim();
  if (value && isRegisteredChannelId(value)) {
    return value;
  }
  throw new Error(renderChannelRequirementMessage(flagName));
}

type RuntimeSummaryChannelDescriptor = {
  channel: ChannelId;
  buildInput: ChannelRuntimeSummaryBuilder;
  order: number;
};

export function listBootstrapChannels() {
  return CHANNEL_PLUGINS
    .filter((plugin) => plugin.bootstrapCli)
    .map((plugin) => plugin.id);
}

export function renderBootstrapUsageLines(indent: string) {
  return CHANNEL_PLUGINS
    .filter((plugin) => plugin.bootstrapCli)
    .map((plugin) => `${indent}${plugin.bootstrapCli!.usageLine}`);
}

export function renderBootstrapExampleCommands(commandName: "init" | "start") {
  return CHANNEL_PLUGINS
    .filter((plugin) => plugin.bootstrapCli)
    .flatMap((plugin) => plugin.bootstrapCli?.renderExampleCommands?.(commandName) ?? []);
}

export function renderBootstrapPrimaryExampleCommand(commandName: "init" | "start") {
  return renderBootstrapExampleCommands(commandName)[0];
}

export function renderBootstrapExplicitFlags(channel: ChannelId) {
  const tokenFlags = requireChannelPlugin(channel).bootstrapCli?.tokenFlags ?? [];
  if (tokenFlags.length === 0) {
    return "explicit channel flags";
  }
  if (tokenFlags.length === 1) {
    return tokenFlags[0]!.flag;
  }
  const [first, ...rest] = tokenFlags.map((tokenFlag) => tokenFlag.flag);
  return `${first} plus ${rest.join(" plus ")}`;
}

export function renderBootstrapExplicitFlagSummary(channels: ChannelId[]) {
  const parts = channels.map((channel) => renderBootstrapExplicitFlags(channel));
  if (parts.length === 0) {
    return "explicit channel flags";
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  if (parts.length === 2) {
    return `${parts[0]} or ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}`;
}

export function listStartupChannelDescriptors(): ChannelStartupDescriptor[] {
  return CHANNEL_PLUGINS.flatMap((plugin) =>
    plugin.operatorInventory?.startup ? [plugin.operatorInventory.startup] : []
  );
}

export function listRuntimeSummaryChannelDescriptors(): RuntimeSummaryChannelDescriptor[] {
  return CHANNEL_PLUGINS
    .flatMap((plugin) =>
      plugin.operatorInventory?.runtimeSummary
        ? [{
          channel: plugin.id,
          buildInput: plugin.operatorInventory.runtimeSummary.buildInput,
          order: plugin.operatorInventory.runtimeSummary.order ?? Number.MAX_SAFE_INTEGER,
        }]
        : []
    )
    .sort((left, right) => left.order - right.order);
}

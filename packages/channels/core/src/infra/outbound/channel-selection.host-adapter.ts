// Fusion-owned host adapter for `src/infra/outbound/channel-selection.ts` (D-CORE-035).
//
// Upstream picks a channel from OpenClaw's `config.json` (configured accounts,
// bootstrap probing, external-plugin repair hints, a dedupe cache over plugin
// discovery). Fusion's Hub decides the channel before the tool runs and the
// capability binds exactly one, so selection here is a lookup in the registered
// plugins plus upstream's fallback rule: an explicit channel wins, otherwise the
// current conversation's provider.
import { getChannelPlugin, listChannelPlugins } from "../../channels/plugins/message-action-discovery.host-adapter.js";
import type { ChannelId, ChannelPlugin, OpenClawConfig } from "../../channels/plugins/types.public.js";

export type MessageChannelSelection = {
  channel: ChannelId;
  plugin: ChannelPlugin;
  source: "explicit" | "tool-context-fallback";
};

export async function resolveMessageChannelSelection(params: {
  cfg: OpenClawConfig;
  channel?: string | null;
  fallbackChannel?: string | null;
  agentId?: string | null;
}): Promise<MessageChannelSelection> {
  const explicit = params.channel?.trim();
  const fallback = params.fallbackChannel?.trim();
  const requested = explicit || fallback;
  if (!requested) {
    throw new Error("No channel selected for this message action.");
  }
  const plugin = getChannelPlugin(requested);
  if (!plugin) {
    throw new Error(`Unknown channel: ${requested}`);
  }
  return {
    channel: plugin.id,
    plugin,
    source: explicit ? "explicit" : "tool-context-fallback",
  };
}

export async function listConfiguredMessageChannels(_cfg: OpenClawConfig): Promise<ChannelId[]> {
  return listChannelPlugins().map((plugin) => plugin.id);
}

export function isConfiguredChannel(channel: string): boolean {
  return getChannelPlugin(channel) !== undefined;
}

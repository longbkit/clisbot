import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { ChannelControlSurfaceContext } from "../../channels/integration/channel-plugin.ts";
import type {
  MessageChannel,
  MessageChildSurfaceSelector,
} from "../../channels/message/message-command.ts";
import { getChannelPlugin } from "../../channels/catalog/registry.ts";

export type LoopCliContext = ChannelControlSurfaceContext;

type LoopCliContextParams = {
  loadedConfig: LoadedConfig;
  channel: MessageChannel;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
};

export function resolveLoopCliContext(params: LoopCliContextParams): LoopCliContext {
  const plugin = getChannelPlugin(params.channel);
  if (!plugin) {
    throw new Error(`Unsupported channel: ${params.channel}`);
  }
  if (!plugin.resolveControlSurfaceContext) {
    throw new Error(`Channel ${params.channel} does not support control-surface resolution.`);
  }
  const context = plugin.resolveControlSurfaceContext({
    loadedConfig: params.loadedConfig,
    target: params.target,
    childSurface: params.childSurface,
    botId: params.botId,
  });
  if (!context) {
    throw new Error(`Unable to resolve ${params.channel} control surface for target \`${params.target}\`.`);
  }
  return context;
}

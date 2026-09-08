// upstream: src/channels/plugins/channel-id.types.ts@5d8067a4483
/**
 * Channel plugin id types.
 *
 * Allows built-in chat channel ids and external plugin-provided channel ids.
 */
import type { ChatChannelId } from "../ids.js";

/**
 * Channel id accepted by plugin helpers, covering built-in chat ids and external plugin ids.
 */
export type ChannelId = ChatChannelId | (string & {});

// Fusion-owned host adapter for `src/utils/message-channel-core.ts` (D-CORE-014).
//
// Upstream resolves built-in channel ids from generated bundled-channel config
// metadata (`src/channels/ids.ts`) and plugin aliases from the process registry
// (`src/channels/registry-normalize.ts`). Fusion resolves both against the
// channel plugins the Hub registered.
import { normalizeAnyChannelId } from "../channels/plugins/message-action-discovery.host-adapter.js";

export { normalizeAnyChannelId };

/**
 * Built-in channel ids. Fusion has no generated bundled-channel metadata, so a
 * registered plugin id is the only "built-in" answer.
 */
export function normalizeChatChannelId(raw?: string | null): string | null {
  return normalizeAnyChannelId(raw);
}

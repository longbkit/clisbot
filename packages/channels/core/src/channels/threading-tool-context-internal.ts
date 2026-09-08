// upstream: src/channels/threading-tool-context-internal.ts@5d8067a4483
import type { ChannelThreadingToolContext } from "./plugins/types.public.js";

/** Host-only turn correlation carried beside the plugin-facing threading contract. */
export type InternalChannelThreadingToolContext = ChannelThreadingToolContext & {
  currentSourceTurnId?: string;
};

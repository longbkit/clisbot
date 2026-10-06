// upstream: extensions/whatsapp/src/channel-actions.runtime.ts@3928bad9bad
// Whatsapp plugin module implements channel actions behavior.
import { createActionGate } from "@clisbot/channels-core/plugin-sdk/channel-actions";
import type { ChannelMessageActionName } from "@clisbot/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";

export { listWhatsAppAccountIds, resolveWhatsAppAccount } from "./accounts.js";
export { resolveWhatsAppReactionLevel } from "./reaction-level.js";
export { createActionGate, type ChannelMessageActionName, type OpenClawConfig };

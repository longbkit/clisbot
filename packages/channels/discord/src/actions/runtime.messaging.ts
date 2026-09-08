// upstream: extensions/discord/src/actions/runtime.messaging.ts@5d8067a4483
// Discord plugin module implements runtime.messaging behavior.
import type { AgentToolResult } from "@getpaseo/channels-core/plugin-sdk/agent-core";
import type { ActionGate } from "@getpaseo/channels-core/plugin-sdk/channel-actions";
import type { DiscordActionConfig, OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { handleDiscordMessageManagementAction } from "./runtime.messaging.messages.js";
import { handleDiscordReactionMessagingAction } from "./runtime.messaging.reactions.js";
import { handleDiscordMessageSendAction } from "./runtime.messaging.send.js";
import {
  createDiscordMessagingActionContext,
  type DiscordMessagingActionOptions,
} from "./runtime.messaging.shared.js";
export async function handleDiscordMessagingAction(
  action: string,
  params: Record<string, unknown>,
  isActionEnabled: ActionGate<DiscordActionConfig>,
  cfg: OpenClawConfig,
  options?: DiscordMessagingActionOptions,
): Promise<AgentToolResult<unknown>> {
  if (!cfg) {
    throw new Error("Discord messaging actions require a resolved runtime config.");
  }
  const ctx = createDiscordMessagingActionContext({
    action,
    input: params,
    isActionEnabled,
    cfg,
    options,
  });
  return (
    (await handleDiscordReactionMessagingAction(ctx)) ??
    (await handleDiscordMessageSendAction(ctx)) ??
    (await handleDiscordMessageManagementAction(ctx)) ??
    (() => {
      throw new Error(`Unknown action: ${action}`);
    })()
  );
}

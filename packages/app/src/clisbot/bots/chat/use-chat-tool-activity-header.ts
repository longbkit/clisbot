import { useMemo } from "react";
import type { ChatBotIdentity } from "./chat-rows";
import type { BotToolActivity } from "./tool-activity";
import type { ChatToolActivityHeader } from "./tool-activity-context";

/** The header's tool activity under the `header` display; `null` in the other displays. */
export function useChatToolActivityHeaderValue({
  enabled,
  serverId,
  group,
  activities,
  identities,
}: {
  enabled: boolean;
  serverId: string;
  group: boolean;
  /** From `useChatHeaderToolActivities`, which keeps it by value across text chunks. */
  activities: BotToolActivity[];
  identities: readonly ChatBotIdentity[];
}): ChatToolActivityHeader | null {
  const bots = useMemo(
    () => new Map(identities.map((bot) => [bot.botId, bot] as const)),
    [identities],
  );
  return useMemo(
    () => (enabled ? { serverId, group, bots, activities } : null),
    [enabled, serverId, group, bots, activities],
  );
}

import { useMemo } from "react";
import type { ChatBotIdentity } from "./chat-rows";
import type { ChatLiveHead } from "./render-model";
import { headerToolActivities } from "./tool-activity";
import type { ChatToolActivityHeader } from "./tool-activity-context";

/** The header's tool activity under the `header` display; `null` in the other displays. */
export function useChatToolActivityHeaderValue({
  enabled,
  serverId,
  group,
  heads,
  identities,
}: {
  enabled: boolean;
  serverId: string;
  group: boolean;
  heads: ReadonlyMap<string, ChatLiveHead>;
  identities: readonly ChatBotIdentity[];
}): ChatToolActivityHeader | null {
  const bots = useMemo(
    () => new Map(identities.map((bot) => [bot.botId, bot] as const)),
    [identities],
  );
  return useMemo(
    () => (enabled ? { serverId, group, bots, activities: headerToolActivities(heads) } : null),
    [enabled, serverId, group, bots, heads],
  );
}

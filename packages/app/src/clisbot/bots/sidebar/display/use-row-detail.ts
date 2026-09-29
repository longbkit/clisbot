import { useMemo } from "react";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useSidebarDisplayStore } from "./preferences";
import { botRowDetail, chatRowDetail, type BotLaunch } from "./row-detail";

/**
 * A bot row's second line. Provider, model, mode and thinking read their labels from the Host's
 * provider snapshot (a shared, cached query), and only when one of them is shown.
 */
export function useBotRowDetail(bot: {
  serverId: string;
  hostName?: string;
  description?: string | null;
  launch?: BotLaunch;
}): string | null {
  const items = useSidebarDisplayStore((state) => state.botRowItems);
  const provider = bot.launch?.provider ?? null;
  const needsLabels = Boolean(
    provider && (items.provider || items.model || items.mode || items.thinking),
  );
  const { entries } = useProvidersSnapshot(needsLabels ? bot.serverId : null, {
    enabled: needsLabels,
  });
  const entry = entries?.find((candidate) => candidate.provider === provider);
  return useMemo(() => botRowDetail(bot, items, entry), [bot, items, entry]);
}

/** A group chat row's second line. */
export function useChatRowDetail(chat: {
  hostName?: string;
  memberNames: readonly string[];
}): string | null {
  const items = useSidebarDisplayStore((state) => state.chatRowItems);
  return useMemo(() => chatRowDetail(chat, items), [chat, items]);
}

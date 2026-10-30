import { useMemo, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { HostTagged } from "@/clisbot/bots/data/aggregate";
import type { BotPayload, ChatPayload } from "@/clisbot/bots/data/contracts";
import { resolveDirectChatOwnership, resolveOwnership } from "./ownership";
import { chatOwnershipEvidence } from "./chat-ownership";
import { useOwnershipHosts } from "./use-ownership-hosts";
import { useReaderAccounts } from "./reader";

interface HeldKeys {
  chats: readonly HostTagged<ChatPayload>[];
  keys: readonly (string | undefined)[];
}

/**
 * Same evidence for Chats, opening a chat outside its filter, and Home's pin tags. While `active`
 * is false (a hidden retained pane) the selector returns the last evidence it read, so session
 * commits neither derive nor re-render; the first active render catches up.
 */
export function useChatOwnership(chats: readonly HostTagged<ChatPayload>[], active = true) {
  const accounts = useReaderAccounts();
  const hostKinds = useOwnershipHosts();
  // The keys line up with the chats they were read for, so only those chats may reuse them.
  const last = useRef<HeldKeys | null>(null);
  // Subscribe to compact sender identities for all chats, not whole session maps.
  const keys = useSessionStore(
    useShallow((state) => {
      if (!active && last.current?.chats === chats) return last.current.keys;
      return chats.map(
        (chat) =>
          chatOwnershipEvidence(chat, state.sessions[chat.serverId]?.agents).participationKey,
      );
    }),
  );
  last.current = { chats, keys };
  return useMemo(() => {
    const participation = new Map(
      chats.map((chat, index) => [`${chat.serverId}:${chat.id}`, keys[index]]),
    );
    const context = (serverId: string) => ({
      accounts,
      hostKind: hostKinds.get(serverId) ?? ("unknown" as const),
    });
    const evidence = (chat: HostTagged<ChatPayload>) => ({
      createdBy: chat.record?.createdBy,
      participationKey: participation.get(`${chat.serverId}:${chat.id}`),
    });
    return {
      chatOwnership: (chat: HostTagged<ChatPayload>) =>
        resolveOwnership({ ...evidence(chat), ...context(chat.serverId) }),
      botOwnership: (
        bot: Pick<HostTagged<BotPayload>, "serverId" | "owner" | "isOwner">,
        direct?: HostTagged<ChatPayload>,
      ) =>
        resolveDirectChatOwnership(
          { bot, directChat: direct ? evidence(direct) : undefined },
          context(bot.serverId),
        ),
    };
  }, [accounts, hostKinds, keys, chats]);
}

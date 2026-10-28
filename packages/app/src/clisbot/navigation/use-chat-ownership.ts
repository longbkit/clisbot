import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { HostTagged } from "@/clisbot/bots/data/aggregate";
import type { BotPayload, ChatPayload } from "@/clisbot/bots/data/contracts";
import { resolveDirectChatOwnership, resolveOwnership } from "./ownership";
import { chatOwnershipEvidence } from "./chat-ownership";
import { useOwnershipHosts } from "./use-ownership-hosts";
import { useReaderAccounts } from "./reader";

/** Same evidence for Chats, opening a chat outside its filter, and Home's pin tags. */
export function useChatOwnership(chats: readonly HostTagged<ChatPayload>[]) {
  const accounts = useReaderAccounts();
  const hostKinds = useOwnershipHosts();
  const needed = useMemo(() => chats.filter((chat) => !chat.record?.createdBy), [chats]);
  // Subscribe only to compact identities for creatorless chats, not whole session maps.
  const keys = useSessionStore(
    useShallow((state) =>
      needed.map(
        (chat) =>
          chatOwnershipEvidence(chat, state.sessions[chat.serverId]?.agents).participationKey,
      ),
    ),
  );
  return useMemo(() => {
    const participation = new Map(
      needed.map((chat, index) => [`${chat.serverId}:${chat.id}`, keys[index]]),
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
  }, [accounts, hostKinds, keys, needed]);
}

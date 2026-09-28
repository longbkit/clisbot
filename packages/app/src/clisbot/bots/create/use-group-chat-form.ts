import { useFormLifetime } from "./use-form-lifetime";
import { useCallback, useState } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedBot } from "../data/use-bots";
import { refreshBotsAndChats } from "../data/runtime";
import {
  groupChatRequest,
  openGroupChatDraft,
  selectGroupHost,
  toggleGroupBot,
} from "./group-chat-form-model";
export interface GroupChatFormProps {
  bots: AggregatedBot[];
  hosts: { serverId: string; label: string }[];
  onCreated: (serverId: string, chatId: string) => void;
}
export function useGroupChatForm({ bots, hosts, onCreated }: GroupChatFormProps) {
  const isCurrent = useFormLifetime();
  const [draft, setDraft] = useState(() => openGroupChatDraft(hosts.map((host) => host.serverId)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hostBots = bots.filter((bot) => bot.serverId === draft.serverId);
  const visible = hostBots.filter((bot) =>
    bot.name.toLocaleLowerCase().includes(draft.search.trim().toLocaleLowerCase()),
  );
  const selectHost = useCallback(
    (id: string) => setDraft((value) => selectGroupHost(value, id)),
    [],
  );
  const selectBot = useCallback((id: string) => setDraft((value) => toggleGroupBot(value, id)), []);
  const setTitle = useCallback((title: string) => setDraft((value) => ({ ...value, title })), []);
  const setSearch = useCallback(
    (search: string) => setDraft((value) => ({ ...value, search })),
    [],
  );
  const setReply = useCallback(
    (reply: string) =>
      setDraft((value) => ({
        ...value,
        requireMention: reply === "mentioned",
      })),
    [],
  );
  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!hosts.some((host) => host.serverId === draft.serverId))
        throw new Error("Host is disconnected");
      const client = getHostRuntimeStore().getClient(draft.serverId);
      if (
        !client ||
        getHostRuntimeStore().getSnapshot(draft.serverId)?.connectionStatus !== "online"
      )
        throw new Error("Host is disconnected");
      const result = await client.createChat(
        groupChatRequest(
          draft,
          bots.filter((bot) => bot.serverId === draft.serverId).map((bot) => bot.id),
        ),
      );
      if (result.error || !result.chat) throw new Error(result.error ?? "Could not create chat");
      refreshBotsAndChats();
      if (isCurrent()) onCreated(draft.serverId, result.chat.id);
    } catch (cause) {
      if (isCurrent()) setError(String(cause));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [bots, draft, hosts, onCreated, isCurrent]);
  return {
    draft,
    hostBots,
    visible,
    error,
    busy,
    selectHost,
    selectBot,
    setTitle,
    setSearch,
    setReply,
    submit,
  };
}

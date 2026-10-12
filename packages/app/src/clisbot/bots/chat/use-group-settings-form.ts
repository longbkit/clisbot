import { useCallback, useState } from "react";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { ChatToolDisplay } from "@clisbot/protocol/chats/tool-display";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { useFormLifetime } from "../create/use-form-lifetime";
import { refreshBotsAndChats } from "../data/runtime";
import {
  groupSettingsPatch,
  hasGroupSettingsChanges,
  openGroupSettingsDraft,
  type GroupSettingsDraft,
} from "./group-settings-model";

/** The draft and one setter per field; `original` is the chat as the form opened it. */
function useGroupSettingsDraft(chat: ChatPayload) {
  const [original] = useState(() => openGroupSettingsDraft(chat));
  const [draft, setDraft] = useState(original);
  const setField = useCallback(
    <K extends keyof GroupSettingsDraft>(key: K, value: GroupSettingsDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    [],
  );
  const setTitle = useCallback((title: string) => setField("title", title), [setField]);
  const setRoundsMax = useCallback((max: number) => setField("roundsMax", max), [setField]);
  const setRoomInstructions = useCallback(
    (text: string) => setField("roomInstructions", text),
    [setField],
  );
  const setReply = useCallback(
    (value: string) => setField("requireMention", value === "mentioned"),
    [setField],
  );
  const setToolCallDisplay = useCallback(
    (value: ChatToolDisplay) => setField("toolCallDisplay", value),
    [setField],
  );
  return {
    original,
    draft,
    setTitle,
    setRoundsMax,
    setRoomInstructions,
    setReply,
    setToolCallDisplay,
  };
}

/** Group settings: the draft, whether the Host can take it, and saving it as one patch. */
export function useGroupSettingsForm(serverId: string, chat: ChatPayload, onSaved: () => void) {
  const isCurrent = useFormLifetime();
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.bots === true,
  );
  // COMPAT(chatToolDisplay): an older Host rejects the patch key; hide the field there.
  const toolCallDisplaySupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.chatToolDisplay === true,
  );
  const fields = useGroupSettingsDraft(chat);
  const { draft, original } = fields;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    if (!client || !online || !supported || busy) return;
    setError(null);
    try {
      const patch = groupSettingsPatch(draft, original);
      if (!patch) return;
      setBusy(true);
      const response = await client.updateChat({ chatId: chat.id, patch });
      if (response.error) throw new Error(response.error);
      refreshBotsAndChats();
      if (isCurrent()) onSaved();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [client, online, supported, busy, draft, original, chat.id, onSaved, isCurrent]);
  const changed = hasGroupSettingsChanges(draft, original);
  return { ...fields, supported, toolCallDisplaySupported, online, busy, error, changed, save };
}

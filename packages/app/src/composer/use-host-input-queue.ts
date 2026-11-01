import { readQueueAttachment, type QueueResult } from "./read-queue-attachment";
import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { InputQueueCommand, InputQueueView } from "@clisbot/protocol/input-queue";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { createQueueProjection, EMPTY_QUEUE_VIEW } from "./host-queue-projection";

interface HostInputQueueOptions {
  client: DaemonClient | null;
  enabled: boolean;
  serverId: string;
  agentId: string;
  chatId?: string;
}
/** Admission-scoped Host projection; editors and unaccepted drafts belong to the composer. */
export function useHostInputQueue(options: HostInputQueueOptions) {
  const { client, enabled, serverId, agentId, chatId } = options;
  const retained = useMemo(
    () => ({ view: EMPTY_QUEUE_VIEW, serverId, agentId, chatId }),
    [serverId, agentId, chatId],
  );
  const snapshot = useHostRuntimeSnapshot(serverId);
  const active = useRetainedPanelActive();
  const key = useMemo(
    () => [
      "host-input-queue",
      serverId,
      chatId ? "chat" : "agent",
      chatId ?? agentId,
      snapshot?.clientGeneration ?? 0,
      snapshot?.connectionEpoch ?? 0,
    ],
    [serverId, chatId, agentId, snapshot?.clientGeneration, snapshot?.connectionEpoch],
  );
  const execute = useCallback(
    (operation: InputQueueCommand) => {
      if (!enabled || !client) throw new Error("Update this Host to use its durable queue");
      return chatId
        ? client.executeChatQueueCommand({ chatId, command: operation })
        : client.executeAgentQueueCommand({ agentId, command: operation });
    },
    [client, enabled, chatId, agentId],
  );
  const readAttachment = useCallback(
    (id: string, fileId: string, size: number) => readQueueAttachment(execute, id, fileId, size),
    [execute],
  );
  const { command, query } = useQueueProjection(key, execute, enabled && active && Boolean(client));
  if (enabled && !query.isError && query.data) retained.view = query.data;
  return {
    view: retained.view,
    command,
    readAttachment,
    error: enabled ? (query.error?.message ?? null) : null,
  };
}

function useQueueProjection(
  key: readonly (string | number)[],
  execute: (operation: InputQueueCommand) => Promise<QueueResult>,
  enabled: boolean,
) {
  const cache = useQueryClient();
  const latestExecute = useRef(execute);
  latestExecute.current = execute;
  // One projection per target and connection, so its request order survives re-renders.
  const command = useMemo(
    () =>
      createQueueProjection(
        {
          read: () => cache.getQueryData<InputQueueView>(key),
          write: (view) => cache.setQueryData(key, view),
        },
        (operation) => latestExecute.current(operation),
      ),
    [cache, key],
  );
  const query = useFetchQuery({
    queryKey: key,
    queryFn: () =>
      command({ action: "fetch", revision: cache.getQueryData<InputQueueView>(key)?.revision }),
    dataShape: "value",
    staleTimeMs: 0,
    enabled,
    refetchInterval: 2000,
    retry: false,
  });
  return { command, query };
}

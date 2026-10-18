import { readQueueAttachment, type QueueResult } from "./read-queue-attachment";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { InputQueueCommand, InputQueueView } from "@clisbot/protocol/input-queue";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";

export class QueueMutationConflict extends Error {
  constructor(
    message: string,
    readonly queue?: InputQueueView,
  ) {
    super(message);
  }
}

const EMPTY: InputQueueView = { revision: 0, items: [] };
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
  return {
    view: enabled && !query.isError ? (query.data ?? EMPTY) : EMPTY,
    command,
    readAttachment,
    error: query.error?.message ?? null,
  };
}

function useQueueProjection(
  key: readonly (string | number)[],
  execute: (operation: InputQueueCommand) => Promise<QueueResult>,
  enabled: boolean,
) {
  const cache = useQueryClient();
  const command = useCallback(
    async (operation: InputQueueCommand) => {
      const result = await execute(operation);
      const previous = cache.getQueryData<InputQueueView>(key);
      if (result.unchanged) return previous ?? EMPTY;
      if (result.queue && (!previous || result.queue.revision >= previous.revision))
        cache.setQueryData(key, result.queue);
      if (result.errorCode === "queue_conflict")
        throw new QueueMutationConflict(result.error ?? "Queue changed", result.queue ?? undefined);
      if (result.error) throw new Error(result.error);
      if (!result.queue) throw new Error("Host did not return queue state");
      return cache.getQueryData<InputQueueView>(key) ?? result.queue;
    },
    [execute, cache, key],
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

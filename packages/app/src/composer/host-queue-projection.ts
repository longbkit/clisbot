import type { InputQueueCommand, InputQueueView } from "@clisbot/protocol/input-queue";
import type { QueueResult } from "./read-queue-attachment";

export class QueueMutationConflict extends Error {
  constructor(
    message: string,
    readonly queue?: InputQueueView,
  ) {
    super(message);
  }
}

export const EMPTY_QUEUE_VIEW: InputQueueView = { revision: 0, items: [] };

export interface QueueViewCache {
  read(): InputQueueView | undefined;
  write(view: InputQueueView): void;
}

/** The Host answered and refused; the command it refused was not admitted. */
export class HostQueueRefusal extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

/**
 * One command path for every queue read and write against one Host target. The Host owns the
 * queue: the answer to the newest request replaces the view even when its revision is lower
 * (a restarted Host, a reset queue file). Only an answer overtaken by a newer one is dropped.
 */
export function createQueueProjection(
  cache: QueueViewCache,
  execute: (operation: InputQueueCommand) => Promise<QueueResult>,
) {
  let issued = 0;
  let applied = 0;
  return async function command(operation: InputQueueCommand): Promise<InputQueueView> {
    const sequence = ++issued;
    const result = await execute(operation);
    const previous = cache.read();
    if (result.unchanged) return previous ?? EMPTY_QUEUE_VIEW;
    const newest = sequence > applied;
    if (result.queue && (newest || !previous || result.queue.revision >= previous.revision)) {
      cache.write(result.queue);
      applied = Math.max(applied, sequence);
    }
    if (result.errorCode === "queue_conflict")
      throw new QueueMutationConflict(result.error ?? "Queue changed", result.queue ?? undefined);
    if (result.error) throw new HostQueueRefusal(result.error, result.errorCode);
    if (!result.queue) throw new Error("Host did not return queue state");
    return cache.read() ?? result.queue;
  };
}

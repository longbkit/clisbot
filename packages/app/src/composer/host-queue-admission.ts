import type { InputQueueCommand } from "@clisbot/protocol/input-queue";
import { HostQueueRefusal, QueueMutationConflict } from "./host-queue-projection";

type EnqueueCommand = Extract<InputQueueCommand, { action: "enqueue" }>;
export type HostQueueContent = Omit<EnqueueCommand, "action" | "id">;

interface QueueAttempt {
  draft: string;
  ids: string[];
  accepted: number;
}

/**
 * Admits one composer draft into the Host queue, as one or more ordered parts. While the
 * outcome of a part is unknown (no answer), retrying the unchanged draft reuses its ID, so the
 * Host deduplicates it. When the Host answered with a refusal, the ID was not admitted and the
 * next attempt uses a new one. A draft key, not the prepared bytes, names the attempt:
 * preparing the same images again may produce other bytes.
 */
export function createHostQueueAdmission(createId: () => string) {
  let attempt: QueueAttempt | null = null;
  return {
    reset() {
      attempt = null;
    },
    async enqueue(input: {
      draft: string;
      prepare: () => Promise<HostQueueContent[]>;
      execute: (command: EnqueueCommand) => Promise<unknown>;
    }): Promise<void> {
      if (attempt?.draft !== input.draft) attempt = { draft: input.draft, ids: [], accepted: 0 };
      const current = attempt;
      const parts = await input.prepare();
      for (let index = current.accepted; index < parts.length; index++) {
        current.ids[index] ??= createId();
        await admit(input.execute, current, index, parts[index]);
        current.accepted = index + 1;
      }
      if (attempt === current) attempt = null;
    },
  };
}

async function admit(
  execute: (command: EnqueueCommand) => Promise<unknown>,
  attempt: QueueAttempt,
  index: number,
  part: HostQueueContent,
): Promise<void> {
  try {
    await execute({ action: "enqueue", id: attempt.ids[index], ...part });
  } catch (error) {
    if (error instanceof HostQueueRefusal && error.code === "already_accepted") return;
    if (error instanceof HostQueueRefusal || error instanceof QueueMutationConflict)
      attempt.ids.splice(index);
    throw error;
  }
}

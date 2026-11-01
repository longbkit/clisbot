import { expect, test } from "vitest";
import type { InputQueueCommand, InputQueueView } from "@clisbot/protocol/input-queue";
import { createQueueProjection, QueueMutationConflict } from "./host-queue-projection";
import type { QueueResult } from "./read-queue-attachment";

function item(id: string): InputQueueView["items"][number] {
  return { id, text: id, state: "queued", createdAt: "fixture" };
}

/** The Host's answers, in the order the test releases them. */
function createHost(initial: InputQueueView) {
  let view = initial;
  return {
    reset(next: InputQueueView) {
      view = next;
    },
    async execute(command: InputQueueCommand): Promise<QueueResult> {
      if (command.action === "fetch" && command.revision === view.revision)
        return {
          requestId: "r",
          queue: { revision: view.revision, items: [] },
          error: null,
          unchanged: true,
        };
      if (command.action === "send_now" || command.action === "steer_now") {
        if (
          command.revision !== view.revision ||
          !view.items.some((value) => value.id === command.id)
        )
          return {
            requestId: "r",
            queue: view,
            error: "Item has already started or was deleted",
            errorCode: "queue_conflict",
          };
        view = {
          revision: view.revision + 1,
          items: view.items.filter((value) => value.id !== command.id),
        };
      }
      return { requestId: "r", queue: view, error: null };
    },
  };
}

function createCache() {
  let view: InputQueueView | undefined;
  return { read: () => view, write: (next: InputQueueView) => void (view = next) };
}

test("a Host whose queue revision went backwards replaces the cached view, and Send now then works", async () => {
  const host = createHost({ revision: 9, items: [item("old")] });
  const cache = createCache();
  const command = createQueueProjection(cache, (operation) => host.execute(operation));
  expect(await command({ action: "fetch" })).toEqual({ revision: 9, items: [item("old")] });

  // The Host restarted with a reset queue file; its revision is now lower than the cache.
  host.reset({ revision: 1, items: [item("new")] });
  expect(await command({ action: "fetch", revision: cache.read()?.revision })).toEqual({
    revision: 1,
    items: [item("new")],
  });

  // A claim with the stale revision is refused once; the refusal carries the Host's queue.
  host.reset({ revision: 2, items: [item("new")] });
  await expect(command({ action: "send_now", id: "new", revision: 1 })).rejects.toBeInstanceOf(
    QueueMutationConflict,
  );
  expect(cache.read()?.revision).toBe(2);
  expect(await command({ action: "send_now", id: "new", revision: 2 })).toEqual({
    revision: 3,
    items: [],
  });
});

test("a response that overtook a later one never replaces the later view", async () => {
  const cache = createCache();
  const answers: Array<(result: QueueResult) => void> = [];
  const command = createQueueProjection(
    cache,
    () => new Promise<QueueResult>((resolve) => answers.push(resolve)),
  );
  const earlier = command({ action: "fetch" });
  const later = command({
    action: "steer_now",
    id: "a",
    revision: 4,
    target: { agentId: "x", turnId: "t" },
  });
  answers[1]({ requestId: "r", queue: { revision: 5, items: [] }, error: null });
  await later;
  answers[0]({ requestId: "r", queue: { revision: 4, items: [item("a")] }, error: null });
  await earlier;
  expect(cache.read()).toEqual({ revision: 5, items: [] });
});

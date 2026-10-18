import { expect, test, vi } from "vitest";
import { ClientChatQueue, ChatQueueNotReady } from "./owner";
import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import type { ComposerAttachment } from "@/attachments/types";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("held Chat ACK serializes double notifications, preserves IDs and distinct identical intentions", async () => {
  const ack = deferred<{ targets: string[] }>();
  const sent: string[] = [];
  const owner = new ClientChatQueue({
    changed: () => {},
    prepare: async (item) => () => {
      sent.push(item.id);
      return ack.promise;
    },
  });
  const a = owner.local.enqueue("same", []).queued!;
  const b = owner.local.enqueue("same", []).queued!;
  expect(a.id).not.toBe(b.id);
  owner.pump();
  owner.pump();
  await flush();
  expect(sent).toEqual([a.id]);
  expect(owner.snapshot()[0]).toMatchObject({ id: a.id, state: "sending" });
  owner.remove(a.id);
  expect(owner.local.save(a.id, JSON.stringify(owner.local.read(a.id)), "bad", [], false)).toBe(
    false,
  );
  expect(owner.local.read(a.id)).toBeDefined();
  ack.resolve({ targets: ["bot"] });
  await flush();
  expect(owner.snapshot().map((i) => i.id)).toEqual([b.id]);
  owner.pump();
  await flush();
  expect(sent).toHaveLength(1);
  owner.observe(true);
  owner.observe(false);
  owner.pump();
  await flush();
  expect(sent).toEqual([a.id, b.id]);
});
test("lost ACK retains item identity for review with no automatic replay or late removal of another draft", async () => {
  const ack = deferred<{ targets: string[] }>();
  const send = vi.fn(() => ack.promise);
  const owner = new ClientChatQueue({ changed: () => {}, prepare: async () => send });
  const a = owner.local.enqueue("accepted server line", []).queued!;
  owner.pump();
  await flush();
  const b = owner.local.enqueue("new local draft", []).queued!;
  ack.reject(new Error("ACK lost after append"));
  await flush();
  owner.pump();
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
  expect(owner.snapshot()).toMatchObject([{ id: a.id, state: "needs_review" }, { id: b.id }]);
});
test("edit during readiness check preserves original position and prevents stale async handoff", async () => {
  const ready = deferred<() => Promise<{ targets: string[] }>>();
  const send = vi.fn(async () => ({ targets: [] }));
  const owner = new ClientChatQueue({ changed: () => {}, prepare: () => ready.promise });
  const a = owner.local.enqueue("first", []).queued!;
  const b = owner.local.enqueue("second", []).queued!;
  owner.pump();
  expect(owner.local.save(b.id, JSON.stringify(b), "edited second", [], false)).toBe(true);
  expect(owner.local.save(a.id, JSON.stringify(a), "edited first", [], false)).toBe(true);
  ready.resolve(send);
  await flush();
  expect(send).not.toHaveBeenCalled();
  expect(owner.snapshot().map((i) => i.text)).toEqual(["edited first", "edited second"]);
});
test("readiness refusal does not consume input; attachment retention outlives draft clear until explicit deletion", async () => {
  const files = [
    { kind: "file", localCopy: { id: "retained-file" } },
    { kind: "image", metadata: { id: "retained-image" } },
  ] as unknown as ComposerAttachment[];
  const owner = new ClientChatQueue({
    changed: () => {},
    prepare: async () => async () => {
      throw new ChatQueueNotReady("disconnected before wire");
    },
  });
  const a = owner.local.enqueue("bytes", files).queued!;
  owner.pump();
  await flush();
  expect(owner.local.read(a.id)).toMatchObject({ state: "queued", attachments: files });
  expect([...collectRetainedAttachmentIds()]).toEqual(
    expect.arrayContaining(["retained-file", "retained-image"]),
  );
  owner.remove(a.id);
  expect(collectRetainedAttachmentIds().has("retained-file")).toBe(false);
});

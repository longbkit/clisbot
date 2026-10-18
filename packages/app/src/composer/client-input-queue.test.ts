import { expect, test } from "vitest";
import { createClientInputQueue } from "./client-input-queue";
import {
  sendQueuedComposerMessageNow,
  type QueuedComposerMessage,
  type QueueWriter,
} from "./actions";
import type { ComposerAttachment } from "@/attachments/types";

function fixture() {
  let state = new Map<string, QueuedComposerMessage[]>();
  const writer: QueueWriter = {
    read: (id) => state.get(id) ?? [],
    write: (update) => {
      state = update(state);
    },
  };
  return createClientInputQueue(writer, "agent");
}

test("local edits retain identity, order and attachment owner; unrelated dequeue is not conflict", () => {
  const queue = fixture();
  const files: ComposerAttachment[] = [
    {
      kind: "agent_attachment",
      attachment: {
        type: "text",
        text: "retained file context",
        title: "context",
        mimeType: "text/plain",
      },
    },
  ];
  const first = queue.enqueue("first", []).queued!;
  const second = queue.enqueue("second", files).queued!;
  const third = queue.enqueue("third", []).queued!;
  const original = JSON.stringify(second);
  queue.remove(first.id);
  expect(queue.save(second.id, original, "edited", files, false)).toBe(true);
  expect(queue.writer.read("agent").map((item) => item.id)).toEqual([second.id, third.id]);
  expect(queue.read(second.id)?.attachments).toBe(files);
  expect(queue.save(second.id, original, "conflict", [], false)).toBe(false);
  expect(queue.save(second.id, JSON.stringify(queue.read(second.id)), "moved", files, true)).toBe(
    true,
  );
  expect(queue.writer.read("agent").map((item) => item.id)).toEqual([third.id, second.id]);
  queue.remove(second.id);
  expect(queue.save(second.id, original, "must not resurrect", files, false)).toBe(false);
});

test("existing immediate send owner restores local item/files on refusal and submits only once", async () => {
  const queue = fixture();
  const item = queue.enqueue("retained", []).queued!;
  expect(
    await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: item.id,
      queue: queue.writer,
      submitMessage: async () => {
        throw new Error("refused");
      },
    }),
  ).toMatchObject({ status: "failed" });
  expect(queue.read(item.id)).toBe(item);
  let submitted = 0;
  expect(
    await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: item.id,
      queue: queue.writer,
      submitMessage: async () => {
        submitted++;
      },
    }),
  ).toEqual({ status: "submitted" });
  expect(
    await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: item.id,
      queue: queue.writer,
      submitMessage: async () => {
        submitted++;
      },
    }),
  ).toEqual({ status: "missing" });
  expect(submitted).toBe(1);
});

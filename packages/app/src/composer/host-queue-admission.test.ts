import { expect, test } from "vitest";
import type { InputQueueCommand } from "@clisbot/protocol/input-queue";
import { createHostQueueAdmission, type HostQueueContent } from "./host-queue-admission";
import { HostQueueRefusal, QueueMutationConflict } from "./host-queue-projection";

type Enqueue = Extract<InputQueueCommand, { action: "enqueue" }>;

/** Accepts each ID once and keeps what it accepted, like the Host queue. */
function createHost() {
  const accepted = new Map<string, string>();
  const requests: string[] = [];
  let failNext: Error | null = null;
  return {
    accepted,
    requests,
    failNext(error: Error) {
      failNext = error;
    },
    async execute(command: Enqueue) {
      requests.push(command.id);
      const { action: _action, id, ...content } = command;
      const body = JSON.stringify(content);
      const previous = accepted.get(id);
      if (previous !== undefined && previous !== body)
        throw new HostQueueRefusal("This message was already accepted.", "already_accepted");
      accepted.set(id, body);
      // The Host accepted it; only the answer is lost on the way back.
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
    },
  };
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

const DRAFT = JSON.stringify({ text: "Compare", attachments: ["image-a"] });
const part = (data: string): HostQueueContent => ({
  text: "Compare",
  images: [{ data, mimeType: "image/jpeg" }],
});

test("a retry after a lost answer reuses the ID and succeeds once", async () => {
  const host = createHost();
  const admission = createHostQueueAdmission(ids());
  host.failNext(new Error("Request timed out"));
  await expect(
    admission.enqueue({ draft: DRAFT, prepare: async () => [part("a")], execute: host.execute }),
  ).rejects.toThrow("Request timed out");
  await admission.enqueue({
    draft: DRAFT,
    prepare: async () => [part("a")],
    execute: host.execute,
  });
  expect(host.requests).toEqual(["id-1", "id-1"]);
  expect([...host.accepted.keys()]).toEqual(["id-1"]);
});

test("the same draft prepared into other bytes is recognized as already accepted", async () => {
  const host = createHost();
  const admission = createHostQueueAdmission(ids());
  host.failNext(new Error("Request timed out"));
  await expect(
    admission.enqueue({ draft: DRAFT, prepare: async () => [part("a")], execute: host.execute }),
  ).rejects.toThrow();
  await admission.enqueue({
    draft: DRAFT,
    prepare: async () => [part("a, re-encoded")],
    execute: host.execute,
  });
  expect([...host.accepted.keys()]).toEqual(["id-1"]);
  // The draft is done: the next message gets a new ID.
  await admission.enqueue({
    draft: DRAFT,
    prepare: async () => [part("a")],
    execute: host.execute,
  });
  expect([...host.accepted.keys()]).toEqual(["id-1", "id-2"]);
});

test("after a refusal the Host answered, the next attempt is a fresh one", async () => {
  for (const refusal of [
    new HostQueueRefusal("Queue is full (32 items)", undefined),
    new QueueMutationConflict("Queue ID conflicts with accepted content"),
  ]) {
    const admission = createHostQueueAdmission(ids());
    const requests: string[] = [];
    let refuse = true;
    const execute = async (command: Enqueue) => {
      requests.push(command.id);
      if (refuse) {
        refuse = false;
        throw refusal;
      }
    };
    await expect(
      admission.enqueue({ draft: DRAFT, prepare: async () => [part("a")], execute }),
    ).rejects.toBe(refusal);
    await admission.enqueue({ draft: DRAFT, prepare: async () => [part("a")], execute });
    expect(requests).toEqual(["id-1", "id-2"]);
  }
});

test("a message split into parts is queued in order and a retry resumes after the accepted parts", async () => {
  const host = createHost();
  const admission = createHostQueueAdmission(ids());
  const parts = [part("1"), part("2"), part("3")];
  let calls = 0;
  const execute = async (command: Enqueue) => {
    calls += 1;
    if (calls === 2) throw new Error("Transport not connected");
    await host.execute(command);
  };
  await expect(
    admission.enqueue({ draft: DRAFT, prepare: async () => parts, execute }),
  ).rejects.toThrow("Transport not connected");
  await admission.enqueue({ draft: DRAFT, prepare: async () => parts, execute });
  expect(
    [...host.accepted.entries()].map(([id, body]) => [id, JSON.parse(body).images[0].data]),
  ).toEqual([
    ["id-1", "1"],
    ["id-2", "2"],
    ["id-3", "3"],
  ]);
});

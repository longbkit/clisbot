import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { SessionEventLog } from "./session-event-log.js";

const directories: string[] = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "iteration-acceptance-"));
  directories.push(directory);
  return { directory, store: new FileAgentTimelineStore(async () => directory) };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
function userMessage(seq: number, text: string, id = `m${seq}`): AgentTimelineRow {
  return {
    seq,
    timestamp: `2026-09-13T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    item: { type: "user_message", messageId: id, text },
  };
}
function assistantChunk(seq: number, messageId: string, text: string): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-13T00:00:00Z",
    turnId: "turn",
    item: { type: "assistant_message", messageId, text },
  };
}
/** A conversation long enough that the newest page cannot contain the oldest message. */
async function longSession(store: FileAgentTimelineStore, turns: number) {
  const rows: AgentTimelineRow[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const base = turn * 10 + 1;
    rows.push(userMessage(base, `question ${turn}`, `ask-${turn}`));
    for (let chunk = 1; chunk < 10; chunk += 1)
      rows.push(assistantChunk(base + chunk, `reply-${turn}`, `chunk ${chunk} `));
  }
  for (let index = 0; index < rows.length; index += 256)
    await store.bulkInsert("a", rows.slice(index, index + 256));
  return rows;
}

describe("iteration layout", () => {
  it("keeps a whole session in session.json, events.jsonl and events.index.json", async () => {
    const { directory, store } = await fixture();
    await fs.writeFile(path.join(directory, "session.json"), "{}");
    await store.writeMessageSubmission("a", {
      id: "c1",
      digest: "d",
      identity: { actor: { kind: "user", id: "u" } },
      timestamp: "2026-09-13T00:00:00Z",
      status: "pending",
    });
    await store.appendCommitted("a", {
      type: "user_message",
      messageId: "m1",
      text: "hello",
      clientMessageId: "c1",
    });
    await store.appendCommitted("a", { type: "assistant_message", messageId: "a1", text: "hi" });
    await store.appendPermissionResponse("a", {
      id: "p1",
      timestamp: "2026-09-13T00:00:01Z",
      status: "pending",
      request: { id: "p1", kind: "tool" },
      response: { behavior: "allow" },
    });
    await store.fetchProjectedCommitted("a", { limit: 10 });
    await store.listPromptIndex("a");
    await store.flush();
    expect((await fs.readdir(directory)).sort()).toEqual([
      "events.index.json",
      "events.jsonl",
      "session.json",
    ]);
    // Timeline, submission and permission records all live in the one canonical log.
    const kinds = (await fs.readFile(path.join(directory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(new Set(kinds)).toEqual(new Set(["timeline", "submission", "permission"]));
  });
});

describe("iteration journal size", () => {
  it("does not grow with the number of streamed chunks for the same assistant text", async () => {
    const words = Array.from({ length: 400 }, (_, index) => `word${index} `);
    const chunked = await fixture();
    for (let index = 0; index < words.length; index += 1)
      await chunked.store.appendCommitted(
        "a",
        { type: "assistant_message", messageId: "reply", text: words[index]! },
        { turnId: "turn" },
      );
    const whole = await fixture();
    await whole.store.appendCommitted(
      "a",
      { type: "assistant_message", messageId: "reply", text: words.join("") },
      { turnId: "turn" },
    );
    const size = async (directory: string) =>
      (await fs.stat(path.join(directory, "events.jsonl"))).size;
    const chunkedBytes = await size(chunked.directory);
    const wholeBytes = await size(whole.directory);
    // What a per-chunk accumulated snapshot chain would have cost.
    const quadratic = words.reduce(
      (total, _, index) => total + Buffer.byteLength(words.slice(0, index + 1).join("")),
      0,
    );
    expect(chunkedBytes).toBeLessThan(quadratic / 4);
    // Streaming costs one bounded envelope per chunk on top of the text itself.
    expect(chunkedBytes).toBeLessThan(wholeBytes + words.length * 256);
    expect(chunkedBytes / words.length).toBeLessThan(512);
    // The projected view still shows one merged message.
    const page = await chunked.store.fetchProjectedCommitted("a", { limit: 10 });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.item).toEqual({
      type: "assistant_message",
      messageId: "reply",
      text: words.join(""),
    });
  });
});

describe("iteration fast jump", () => {
  it("lists every prompt from anchors alone and never pages the whole log to do it", async () => {
    const { directory, store } = await fixture();
    await longSession(store, 60);
    await store.flush();
    SessionEventLog.forgetAll();
    const restarted = new FileAgentTimelineStore(async () => directory);
    let logBytes = 0;
    const open = fs.open.bind(fs);
    const spy = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith("events.jsonl")) {
        const read = handle.read.bind(handle);
        handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
          const result = await read(...readArgs);
          logBytes += result.bytesRead;
          return result;
        }) as typeof handle.read;
      }
      return handle;
    };
    (fs as { open: typeof fs.open }).open = spy as typeof fs.open;
    try {
      const prompts = await restarted.listPromptIndex("a");
      expect(prompts.prompts.map((prompt) => prompt.seq)).toEqual(
        Array.from({ length: 60 }, (_, turn) => turn * 10 + 1),
      );
      expect(prompts.prompts[0]!.preview).toBe("question 0");
      expect(logBytes).toBe(0);
    } finally {
      (fs as { open: typeof fs.open }).open = open;
    }
  });

  it("jumps to a message outside the last page after a restart with empty memory", async () => {
    const { directory, store } = await fixture();
    await longSession(store, 60);
    await store.flush();
    SessionEventLog.forgetAll();
    const restarted = new FileAgentTimelineStore(async () => directory);
    const tail = await restarted.fetchCommitted("a", { limit: 40 });
    expect(tail.rows[0]!.seq).toBeGreaterThan(1);
    const anchor = (await restarted.listPromptIndex("a")).prompts[0]!;
    expect(anchor.seq).toBe(1);
    const jumped = await restarted.fetchCommitted("a", {
      direction: "after",
      cursor: { epoch: tail.epoch, seq: anchor.seq - 1 },
      limit: 20,
    });
    expect(jumped.rows[0]!.seq).toBe(1);
    expect(jumped.rows[0]!.item).toMatchObject({ text: "question 0" });
    expect(jumped.hasNewer).toBe(true);
  });

  it("rebuilds a missing or corrupt index and still jumps to the same message", async () => {
    const { directory, store } = await fixture();
    await longSession(store, 40);
    await store.flush();
    const epoch = await store.getEpoch("a");
    for (const damage of ["corrupt", null]) {
      const index = path.join(directory, "events.index.json");
      if (damage) await fs.writeFile(index, damage);
      else await fs.rm(index);
      SessionEventLog.forgetAll();
      const restarted = new FileAgentTimelineStore(async () => directory);
      const prompts = await restarted.listPromptIndex("a");
      expect(prompts.epoch).toBe(epoch);
      expect(prompts.prompts.map((prompt) => prompt.seq)).toEqual(
        Array.from({ length: 40 }, (_, turn) => turn * 10 + 1),
      );
      const jumped = await restarted.fetchCommitted("a", {
        direction: "after",
        cursor: { epoch, seq: 200 },
        limit: 5,
      });
      expect(jumped.rows.map((row) => row.seq)).toEqual([201, 202, 203, 204, 205]);
    }
  });

  it("keeps a prompt preview and seq stable while its turn keeps streaming", async () => {
    const { store } = await fixture();
    await store.bulkInsert("a", [userMessage(1, "  the   original question ", "ask")]);
    const before = (await store.listPromptIndex("a")).prompts;
    for (let chunk = 0; chunk < 20; chunk += 1)
      await store.appendCommitted(
        "a",
        { type: "assistant_message", messageId: "reply", text: `chunk ${chunk} ` },
        { turnId: "turn" },
      );
    expect((await store.listPromptIndex("a")).prompts).toEqual(before);
    expect(before[0]).toMatchObject({ seq: 1, preview: "the original question" });
  });
});

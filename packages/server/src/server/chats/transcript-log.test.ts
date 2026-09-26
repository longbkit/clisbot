import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SessionEventLog } from "../agent/session-storage/session-event-log.js";
import { TranscriptLog, type TranscriptLineInput } from "./transcript-log.js";

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-transcript-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  SessionEventLog.forgetAll();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function userLine(id: string, text = id): TranscriptLineInput {
  return { id, at: "2026-09-26T00:00:00.000Z", sender: { kind: "user" }, text, hop: 0 };
}

describe("TranscriptLog", () => {
  test("allocates seqs from 1 and writes transcript.jsonl beside its index", async () => {
    const directory = await temporary();
    const log = new TranscriptLog(directory);
    const first = await log.append(userLine("m1"));
    const second = await log.append({
      id: "m2",
      at: "2026-09-26T00:00:01.000Z",
      sender: { kind: "bot", botId: "bot_a" },
      text: "hello",
      reply: { agentId: "agent-1", turnId: "turn-1", epoch: "e", seq: 4 },
      inReplyTo: "m1",
      hop: 1,
    });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    await log.flush();
    const files = (await fs.readdir(directory)).sort();
    expect(files).toEqual(["transcript.index.json", "transcript.jsonl"]);
    const rows = (await fs.readFile(path.join(directory, "transcript.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row) as { kind: string; seq: number; value: { id: string } });
    expect(rows.map((row) => [row.kind, row.seq, row.value.id])).toEqual([
      ["transcript", 1, "m1"],
      ["transcript", 2, "m2"],
    ]);
  });

  test("continues the seq after a reopen and rebuilds the index when it is deleted", async () => {
    const directory = await temporary();
    const log = new TranscriptLog(directory);
    await log.append(userLine("m1"));
    await log.append(userLine("m2"));
    await log.flush();
    SessionEventLog.forgetAll();

    const reopened = new TranscriptLog(directory);
    expect((await reopened.append(userLine("m3"))).seq).toBe(3);
    await reopened.flush();
    SessionEventLog.forgetAll();
    await fs.rm(path.join(directory, "transcript.index.json"));

    const rebuilt = new TranscriptLog(directory);
    expect(await rebuilt.state()).toEqual({ minSeq: 1, maxSeq: 3 });
    expect((await rebuilt.fetch()).lines.map((line) => line.id)).toEqual(["m1", "m2", "m3"]);
    expect((await rebuilt.append(userLine("m4"))).seq).toBe(4);
    expect((await rebuilt.findById("m2"))?.seq).toBe(2);
  });

  test("pages tail, before and after windows like the timeline fetch", async () => {
    const log = new TranscriptLog(await temporary());
    for (let index = 1; index <= 5; index += 1) await log.append(userLine(`m${index}`));

    const tail = await log.fetch({ limit: 2 });
    expect(tail.lines.map((line) => line.seq)).toEqual([4, 5]);
    expect(tail).toMatchObject({ hasOlder: true, hasNewer: false, startSeq: 4, endSeq: 5 });

    const before = await log.fetch({ direction: "before", cursor: { seq: 4 }, limit: 2 });
    expect(before.lines.map((line) => line.seq)).toEqual([2, 3]);
    expect(before).toMatchObject({ hasOlder: true, hasNewer: true });

    const after = await log.fetch({ direction: "after", cursor: { seq: 3 }, limit: 10 });
    expect(after.lines.map((line) => line.seq)).toEqual([4, 5]);
    expect(after).toMatchObject({ hasOlder: true, hasNewer: false });

    const all = await log.fetch({ limit: 0 });
    expect(all.lines.map((line) => line.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all).toMatchObject({ hasOlder: false, hasNewer: false, startSeq: 1, endSeq: 5 });

    expect(await log.since(2, 2)).toMatchObject([{ seq: 4 }, { seq: 5 }]);
    expect(await log.since(3, 20)).toMatchObject([{ seq: 4 }, { seq: 5 }]);
    expect(await log.since(5, 20)).toEqual([]);
  });

  test("an empty transcript fetches an empty window", async () => {
    const log = new TranscriptLog(await temporary());
    expect(await log.fetch()).toEqual({
      lines: [],
      hasOlder: false,
      hasNewer: false,
      startSeq: 0,
      endSeq: 0,
    });
    expect(await log.findById("missing")).toBeNull();
  });

  test("concurrent appends get distinct, gapless seqs", async () => {
    const log = new TranscriptLog(await temporary());
    const lines = await Promise.all(
      Array.from({ length: 12 }, (_, index) => log.append(userLine(`m${index}`))),
    );
    expect(lines.map((line) => line.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    const stored = await log.fetch({ limit: 0 });
    expect(stored.lines.map((line) => line.id)).toEqual(lines.map((line) => line.id));
  });
});

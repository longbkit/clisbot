import { describe, expect, test } from "bun:test";
import { SessionEventFeed } from "../src/agents/session/run-event-feed.ts";

const target = { sessionKey: "session-1", agentId: "default" };

describe("SessionEventFeed", () => {
  test("replays entries after a given sequence and keeps them ordered", () => {
    const feed = new SessionEventFeed();
    feed.publishUpdate(target, { status: "running", snapshot: "one" });
    feed.publishUpdate(target, { status: "running", snapshot: "two" });
    feed.publishRunEvent(target, { type: "message-delta", role: "assistant", text: "hi" });

    const all = feed.read(target.sessionKey);
    expect(all).toHaveLength(3);
    expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3]);

    const tail = feed.read(target.sessionKey, all[1]!.seq);
    expect(tail).toHaveLength(1);
    expect(tail[0]!.payload.kind).toBe("run-event");
    expect(feed.read("unknown-session")).toEqual([]);
  });

  test("notifies subscribers live and stops after unsubscribe", () => {
    const feed = new SessionEventFeed();
    const seen: number[] = [];
    const unsubscribe = feed.subscribe(target.sessionKey, (entry) => {
      seen.push(entry.seq);
    });

    feed.publishUpdate(target, { status: "running", snapshot: "live" });
    unsubscribe();
    feed.publishUpdate(target, { status: "completed", snapshot: "done" });

    expect(seen).toEqual([1]);
  });

  test("bounds retained history per session and isolates broken listeners", () => {
    const feed = new SessionEventFeed();
    feed.subscribe(target.sessionKey, () => {
      throw new Error("broken subscriber");
    });
    const seen: number[] = [];
    feed.subscribe(target.sessionKey, (entry) => seen.push(entry.seq));

    for (let index = 0; index < 205; index += 1) {
      feed.publishUpdate(target, { status: "running", snapshot: `s${index}` });
    }

    const retained = feed.read(target.sessionKey);
    expect(retained).toHaveLength(200);
    expect(retained[0]!.seq).toBe(6);
    expect(seen).toHaveLength(205);
  });

  test("bounds snapshot size per entry", () => {
    const feed = new SessionEventFeed();
    feed.publishUpdate(target, { status: "running", snapshot: "x".repeat(20_000) });

    const [entry] = feed.read(target.sessionKey);
    expect(entry!.payload.kind).toBe("run-update");
    expect(
      entry!.payload.kind === "run-update" ? entry!.payload.snapshot.length : 0,
    ).toBe(8_000);
  });
});

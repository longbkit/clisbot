import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { OutboundPacer } from "./outbound-pacer.js";

const ROUTE = {
  audienceRules: [],
  where: { dm: false, groups: [], conversations: ["C1"] },
  target: { kind: "agent", agent: "a", environment: "e", template: null },
  limits: { messagesSentPerMinute: 1 },
} as unknown as CompiledRoute;

/** Only the fields the pacer reads. */
function account(limits: CompiledChannelAccount["limits"]): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: "bot",
    routes: [ROUTE],
    ...(limits === undefined ? {} : { limits }),
  } as unknown as CompiledChannelAccount;
}

interface Post {
  to: string;
  threadId?: string;
  text: string;
  priority?: "progress";
}

/** A pacer on a fake clock: `sleep` advances time instead of waiting. A text
 * that `hang` names never finishes posting. */
function pacer(
  limits: CompiledChannelAccount["limits"],
  options: { hang?: ReadonlySet<string>; writeTimeoutMs?: number } = {},
) {
  let now = 0;
  const sent: string[] = [];
  const instance = new OutboundPacer({
    account: account(limits),
    logger: { warn: () => undefined },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    ...(options.writeTimeoutMs === undefined ? {} : { writeTimeoutMs: options.writeTimeoutMs }),
  });
  const paced = instance.paced(async (params) => {
    if (options.hang?.has(params.text)) return new Promise<never>(() => undefined);
    const thread = params.threadId === undefined ? "" : `/${params.threadId}`;
    sent.push(`${params.to}${thread}:${params.text}@${String(now)}`);
    return { ok: true, externalMessageId: params.text };
  });
  const post = (params: Post) => paced({ channel: "slack", accountId: "bot", ...params });
  return { instance, post, sent };
}

describe("OutboundPacer", () => {
  it("passes every message through at once when nothing is limited", async () => {
    const { post, sent } = pacer(undefined);
    for (let index = 0; index < 50; index += 1) await post({ to: "C1", text: String(index) });
    assert.ok(sent.every((entry) => entry.endsWith("@0")));
  });

  it("delays, never drops, and keeps order within a conversation", async () => {
    const { post, sent } = pacer({ perConversation: { messagesSentPerMinute: 2 } });
    await Promise.all(["a", "b", "c", "d"].map((text) => post({ to: "C1", text })));
    assert.deepEqual(sent, ["C1:a@0", "C1:b@0", "C1:c@60000", "C1:d@60000"]);
  });

  it("does not hold one conversation up behind another's backlog", async () => {
    const { post, sent } = pacer({
      bot: { messagesSentPerMinute: 100 },
      perConversation: { messagesSentPerMinute: 1 },
    });
    // C1's second message waits a minute for its own conversation limit…
    const waiting = Promise.all([post({ to: "C1", text: "a" }), post({ to: "C1", text: "b" })]);
    // …while C2 still has room in the Bot window and goes out now.
    await post({ to: "C2", text: "x" });
    await waiting;
    assert.ok(sent.includes("C2:x@0"), JSON.stringify(sent));
    assert.ok(sent.includes("C1:b@60000"), JSON.stringify(sent));
  });

  it("shares the Bot window across conversations", async () => {
    const { post, sent } = pacer({ bot: { messagesSentPerMinute: 1 } });
    await post({ to: "C1", text: "a" });
    await post({ to: "C2", text: "b" });
    assert.deepEqual(sent, ["C1:a@0", "C2:b@60000"]);
  });

  it("paces a conversation by the Route that served it", async () => {
    const { instance, post, sent } = pacer(undefined);
    instance.noteRoute("C1", ROUTE);
    await post({ to: "C1", text: "a" });
    await post({ to: "C1", text: "b" });
    await post({ to: "C2", text: "c" });
    assert.deepEqual(sent, ["C1:a@0", "C1:b@60000", "C2:c@60000"]);
  });

  it("keeps two threads of one channel from waiting for each other", async () => {
    let finishFirst: () => void = () => undefined;
    const instance = new OutboundPacer({
      account: account({ perConversation: { messagesSentPerMinute: 100 } }),
      logger: { warn: () => undefined },
    });
    const post = instance.paced(async (params) => {
      if (params.threadId === "T1") await new Promise<void>((resolve) => (finishFirst = resolve));
      return { ok: true, externalMessageId: params.threadId };
    });
    const base = { channel: "slack", accountId: "bot", to: "C1" } as const;
    const first = post({ ...base, threadId: "T1", text: "slow" });
    const second = await post({ ...base, threadId: "T2", text: "fast" });
    assert.equal(second.externalMessageId, "T2");
    finishFirst();
    assert.equal((await first).externalMessageId, "T1");
  });

  it("keeps one thread in order while the other thread shares its Conversation window", async () => {
    const { post, sent } = pacer({ perConversation: { messagesSentPerMinute: 1 } });
    await Promise.all([
      post({ to: "C1", threadId: "T1", text: "a" }),
      post({ to: "C1", threadId: "T1", text: "b" }),
      post({ to: "C1", threadId: "T2", text: "x" }),
    ]);
    // One fake clock serves both threads, so only the order is meaningful: T2
    // takes the Conversation window's second slot rather than waiting for T1's b.
    const order = sent.map((entry) => entry.slice(0, entry.indexOf("@")));
    assert.deepEqual(order, ["C1/T1:a", "C1/T2:x", "C1/T1:b"]);
    assert.ok(sent.at(-1)?.endsWith("@120000"), JSON.stringify(sent));
  });

  it("times a hung write out and releases the thread's turn", async () => {
    const { post, sent } = pacer(
      { perConversation: { messagesSentPerMinute: 100 } },
      { hang: new Set(["stuck"]), writeTimeoutMs: 5 },
    );
    const [stuck, next] = await Promise.all([
      post({ to: "C1", threadId: "T1", text: "stuck" }),
      post({ to: "C1", threadId: "T1", text: "next" }),
    ]);
    assert.equal(stuck.ok, false);
    assert.equal(stuck.failure?.kind, "timeout");
    assert.equal(stuck.failure?.mayHavePosted, true);
    assert.equal(next.ok, true);
    assert.deepEqual(sent, ["C1/T1:next@0"]);
  });

  it("times a hung write out when nothing is limited", async () => {
    const { post } = pacer(undefined, { hang: new Set(["stuck"]), writeTimeoutMs: 5 });
    const result = await post({ to: "C1", text: "stuck" });
    assert.equal(result.failure?.kind, "timeout");
  });

  it("keeps only the newest progress line waiting in a thread", async () => {
    const { post, sent } = pacer({ perConversation: { messagesSentPerMinute: 1 } });
    const results = await Promise.all([
      post({ to: "C1", text: "answer" }),
      post({ to: "C1", text: "p1", priority: "progress" }),
      post({ to: "C1", text: "p2", priority: "progress" }),
      post({ to: "C1", text: "p3", priority: "progress" }),
    ]);
    assert.deepEqual(sent, ["C1:answer@0", "C1:p3@60000"]);
    assert.deepEqual(
      results.map((result) => result.failure?.kind ?? "posted"),
      ["posted", "superseded", "superseded", "posted"],
    );
  });

  it("sends a queued answer ahead of queued progress in the same thread", async () => {
    const { post, sent } = pacer({ perConversation: { messagesSentPerMinute: 1 } });
    await Promise.all([
      post({ to: "C1", text: "first" }),
      post({ to: "C1", text: "progress", priority: "progress" }),
      post({ to: "C1", text: "final" }),
    ]);
    assert.deepEqual(sent, ["C1:first@0", "C1:final@60000", "C1:progress@120000"]);
  });

  it("fails waiting writes as canceled when the account stops, and sends nothing later", async () => {
    const stop = new AbortController();
    const sent: string[] = [];
    const sleeps: Array<() => void> = [];
    const instance = new OutboundPacer({
      account: account({ perConversation: { messagesSentPerMinute: 1 } }),
      logger: { warn: () => undefined },
      now: () => 0,
      // The waiting write sleeps until the test lets it go.
      sleep: (_ms, signal) =>
        new Promise<void>((resolve) => {
          sleeps.push(resolve);
          signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
      abortSignal: stop.signal,
    });
    const post = instance.paced(async (params) => {
      sent.push(params.text);
      return { ok: true, externalMessageId: params.text };
    });
    const base = { channel: "slack", accountId: "bot", to: "C1" } as const;
    assert.equal((await post({ ...base, text: "first" })).ok, true);
    const waiting = post({ ...base, text: "second" });
    stop.abort();
    const result = await waiting;
    assert.deepEqual([result.ok, result.failure?.kind], [false, "canceled"]);
    for (const wake of sleeps) wake();
    await Promise.resolve();
    assert.deepEqual(sent, ["first"]);
    const late = await post({ ...base, text: "after stop" });
    assert.equal(late.failure?.kind, "canceled");
    assert.deepEqual(sent, ["first"]);
  });
});

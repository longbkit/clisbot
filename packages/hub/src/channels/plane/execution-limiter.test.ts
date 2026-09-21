import assert from "node:assert/strict";
import { compileAudienceRule } from "../config/audience.js";
import { describe, it } from "vitest";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { ChannelExecutionLimiter } from "./execution-limiter.js";

const defaults: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  inbound: { reactionNotifications: "off", editNotifications: "off" },
  sync: {
    finalAnswers: true,
    progress: {
      progressMessage: false,
      typingIndicator: false,
      messageReaction: "off",
    },
    toolCalls: false,
    threadLink: "none",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

function fixture() {
  const route: CompiledRoute = {
    audienceRules: [
      compileAudienceRule({ who: { anyone: true }, where: { conversations: ["C_PUBLIC"] } }),
    ],
    where: { dm: false, groups: [], conversations: ["C_PUBLIC"] },
    target: {
      kind: "agent",
      agent: "worker",
      environment: "repo",
      template: null,
    },
    defaultRoles: [],
    assignments: [],
    defaults,
    approval: [{ match: "*", mode: "auto-deny" }],
    limits: {
      maxInputCharacters: 8,
      messagesPerMinutePerSender: 2,
      messagesPerMinute: 3,
      maxConcurrentRuns: 1,
      maxRuntimeSeconds: 10,
    },
  };
  const account: CompiledChannelAccount = {
    channel: "slack",
    accountId: "public",
    enabled: true,
    channelEnabled: true,
    connectionId: "connection",
    transport: {},
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults,
    approval: [],
    routes: [route],
  };
  let now = 1_000;
  const running = new Set<string>();
  const timers = new Map<number, () => void>();
  let sequence = 0;
  const cancelled: string[] = [];
  const limiter = new ChannelExecutionLimiter({
    now: () => now,
    cancelAgent: async (agentId) => {
      cancelled.push(agentId);
    },
    logger: { warn: () => undefined },
    readRunningAgentIds: async () => running,
    schedule: (callback) => {
      const id = sequence++;
      timers.set(id, callback);
      return () => timers.delete(id);
    },
  });
  return {
    account,
    route,
    limiter,
    cancelled,
    running,
    advance(ms: number) {
      now += ms;
    },
    expire() {
      for (const callback of timers.values()) callback();
    },
  };
}

describe("ChannelExecutionLimiter", () => {
  it("enforces input, concurrency, sender, and aggregate rate limits", () => {
    const f = fixture();
    assert.equal(
      f.limiter.admit({
        account: f.account,
        route: f.route,
        conversationId: "C_PUBLIC",
        senderIdentity: "slack:alice",
        text: "123456789",
      }).allowed,
      false,
    );
    const first = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(first.allowed, true);
    const concurrent = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:bob",
      text: "two",
    });
    assert.equal(concurrent.allowed, false);
    if (concurrent.allowed) return;
    assert.match(concurrent.reason, /concurrency/u);
    f.limiter.complete(first.allowed ? first.lease : undefined);
    const second = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "two",
    });
    assert.equal(second.allowed, true);
    f.limiter.complete(second.allowed ? second.lease : undefined);
    const senderLimited = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "three",
    });
    assert.equal(senderLimited.allowed, false);

    const aggregate = fixture();
    delete aggregate.route.limits?.maxConcurrentRuns;
    for (const sender of ["one", "two", "three"]) {
      const admitted = aggregate.limiter.admit({
        account: aggregate.account,
        route: aggregate.route,
        conversationId: "C_PUBLIC",
        senderIdentity: `slack:${sender}`,
        text: sender,
      });
      assert.equal(admitted.allowed, true);
      aggregate.limiter.complete(admitted.allowed ? admitted.lease : undefined);
    }
    const routeLimited = aggregate.limiter.admit({
      account: aggregate.account,
      route: aggregate.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:four",
      text: "four",
    });
    assert.equal(routeLimited.allowed, false);
    if (routeLimited.allowed) return;
    assert.match(routeLimited.reason, /rate limit/u);
  });

  it("tells back-pressure apart from a refusal that will never clear", () => {
    const f = fixture();
    const tooLong = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "123456789",
    });
    assert.equal(tooLong.allowed, false);
    // The message is over the Route's size ceiling: waiting changes nothing, so
    // it carries no retry hint and a durable ingress must not hold it.
    if (!tooLong.allowed) assert.equal(tooLong.retryAfterMs, undefined);

    const running = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(running.allowed, true);
    const concurrent = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:bob",
      text: "two",
    });
    assert.equal(concurrent.allowed, false);
    if (!concurrent.allowed) assert.ok((concurrent.retryAfterMs ?? 0) > 0);

    f.limiter.complete(running.allowed ? running.lease : undefined);
    const second = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "two",
    });
    assert.equal(second.allowed, true);
    f.limiter.complete(second.allowed ? second.lease : undefined);
    // Two messages from Alice inside the window; the third waits out the rest
    // of the window the first one opened.
    f.advance(15_000);
    const senderLimited = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "three",
    });
    assert.equal(senderLimited.allowed, false);
    if (!senderLimited.allowed) assert.equal(senderLimited.retryAfterMs, 45_000);
  });

  it("releases concurrency on completion and cancels at the runtime limit", async () => {
    const f = fixture();
    const first = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(first.allowed, true);
    if (!first.allowed) return;
    f.limiter.bind(first.lease, "agent-1");
    f.limiter.complete(first.lease);
    const second = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:bob",
      text: "two",
    });
    assert.equal(second.allowed, true);
    if (!second.allowed) return;
    f.limiter.bind(second.lease, "agent-2");
    f.expire();
    await Promise.resolve();
    assert.deepEqual(f.cancelled, ["agent-2"]);
  });

  it("frees a slot whose run ended without its terminal event being seen", async () => {
    const f = fixture();
    const admit = (senderIdentity: string) =>
      f.limiter.admit({
        account: f.account,
        route: f.route,
        conversationId: "C_PUBLIC",
        senderIdentity,
        text: "go",
      });
    const first = admit("slack:alice");
    assert.equal(first.allowed, true);
    if (!first.allowed) return;
    f.limiter.bind(first.lease, "agent-1");
    f.running.add("agent-1");

    f.advance(31_000);
    assert.equal(admit("slack:bob").allowed, false, "the run is alive: the slot is held");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(admit("slack:bob").allowed, false, "a running agent keeps its lease");

    f.running.delete("agent-1");
    f.advance(16_000);
    assert.equal(admit("slack:carol").allowed, false, "this refusal asks the Host");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(admit("slack:carol").allowed, true, "the dead run's slot is free");
  });

  it("cancels each active Agent once during policy replacement", async () => {
    const f = fixture();
    const admitted = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(admitted.allowed, true);
    if (!admitted.allowed) return;
    f.limiter.bind(admitted.lease, "agent-1");
    await f.limiter.cancelActive();
    assert.deepEqual(f.cancelled, ["agent-1"]);
  });

  it("counts the Bot and each Conversation on their own", () => {
    const f = fixture();
    delete f.route.limits;
    f.account.limits = {
      bot: { messagesPerMinute: 3 },
      perConversation: { maxConcurrentRuns: 1 },
    };
    const admit = (conversationId: string, sender: string) =>
      f.limiter.admit({
        account: f.account,
        route: f.route,
        conversationId,
        senderIdentity: `slack:${sender}`,
        text: "hi",
      });
    const first = admit("C_ONE", "alice");
    assert.equal(first.allowed, true);
    // One run per conversation: C_ONE is busy, C_TWO is not.
    const busy = admit("C_ONE", "bob");
    assert.equal(busy.allowed, false);
    if (!busy.allowed) assert.match(busy.reason, /^Conversation concurrency/u);
    const other = admit("C_TWO", "bob");
    assert.equal(other.allowed, true);
    f.limiter.complete(first.allowed ? first.lease : undefined);
    f.limiter.complete(other.allowed ? other.lease : undefined);
    // The Bot counted three admitted messages across both conversations.
    assert.equal(admit("C_ONE", "carol").allowed, true);
    const botLimited = admit("C_THREE", "dave");
    assert.equal(botLimited.allowed, false);
    if (!botLimited.allowed) assert.match(botLimited.reason, /^Bot rate limit exceeded$/u);
  });

  it("admits without a lease when no scope limits anything", () => {
    const f = fixture();
    delete f.route.limits;
    const admitted = f.limiter.admit({
      account: f.account,
      route: f.route,
      conversationId: "C_PUBLIC",
      senderIdentity: "slack:alice",
      text: "x".repeat(100_000),
    });
    assert.deepEqual(admitted, { allowed: true });
  });

  it("cancels only open-audience runs when the policy is replaced", async () => {
    const f = fixture();
    const member = { ...f.route, audienceRules: [], limits: {} };
    f.account.limits = { bot: { maxConcurrentRuns: 5 } };
    const admit = (route: typeof f.route, sender: string) =>
      f.limiter.admit({
        account: f.account,
        route,
        conversationId: "C_PUBLIC",
        senderIdentity: `slack:${sender}`,
        text: "hi",
      });
    const open = admit(f.route, "alice");
    const members = admit(member, "bob");
    if (!open.allowed || !members.allowed) throw new Error("both should be admitted");
    f.limiter.bind(open.lease, "agent-open");
    f.limiter.bind(members.lease, "agent-member");
    await f.limiter.cancelActive();
    assert.deepEqual(f.cancelled, ["agent-open"]);
  });
});

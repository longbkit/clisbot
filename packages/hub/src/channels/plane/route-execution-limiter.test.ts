import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { RouteExecutionLimiter } from "./route-execution-limiter.js";

const defaults: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
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
    match: { kind: "channel", ids: ["C_PUBLIC"] },
    audience: { kind: "conversationParticipants" },
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
    fallback: { deny: true },
  };
  let now = 1_000;
  const timers = new Map<number, () => void>();
  let sequence = 0;
  const cancelled: string[] = [];
  const limiter = new RouteExecutionLimiter({
    now: () => now,
    cancelAgent: async (agentId) => {
      cancelled.push(agentId);
    },
    logger: { warn: () => undefined },
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
    advance(ms: number) {
      now += ms;
    },
    expire() {
      for (const callback of timers.values()) callback();
    },
  };
}

describe("RouteExecutionLimiter", () => {
  it("enforces input, concurrency, sender, and aggregate rate limits", () => {
    const f = fixture();
    assert.equal(
      f.limiter.admit({
        account: f.account,
        route: f.route,
        senderIdentity: "slack:alice",
        text: "123456789",
      }).allowed,
      false,
    );
    const first = f.limiter.admit({
      account: f.account,
      route: f.route,
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(first.allowed, true);
    const concurrent = f.limiter.admit({
      account: f.account,
      route: f.route,
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
      senderIdentity: "slack:alice",
      text: "two",
    });
    assert.equal(second.allowed, true);
    f.limiter.complete(second.allowed ? second.lease : undefined);
    const senderLimited = f.limiter.admit({
      account: f.account,
      route: f.route,
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
        senderIdentity: `slack:${sender}`,
        text: sender,
      });
      assert.equal(admitted.allowed, true);
      aggregate.limiter.complete(admitted.allowed ? admitted.lease : undefined);
    }
    const routeLimited = aggregate.limiter.admit({
      account: aggregate.account,
      route: aggregate.route,
      senderIdentity: "slack:four",
      text: "four",
    });
    assert.equal(routeLimited.allowed, false);
    if (routeLimited.allowed) return;
    assert.match(routeLimited.reason, /rate limit/u);
  });

  it("releases concurrency on completion and cancels at the runtime limit", async () => {
    const f = fixture();
    const first = f.limiter.admit({
      account: f.account,
      route: f.route,
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

  it("cancels each active Agent once during policy replacement", async () => {
    const f = fixture();
    const admitted = f.limiter.admit({
      account: f.account,
      route: f.route,
      senderIdentity: "slack:alice",
      text: "one",
    });
    assert.equal(admitted.allowed, true);
    if (!admitted.allowed) return;
    f.limiter.bind(admitted.lease, "agent-1");
    await f.limiter.cancelActive();
    assert.deepEqual(f.cancelled, ["agent-1"]);
  });
});

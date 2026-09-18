import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { OutboundPacer } from "./outbound-pacer.js";

const ROUTE = {
  match: { kind: "channel", ids: ["C1"] },
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

/** A pacer on a fake clock: `sleep` advances time instead of waiting. */
function pacer(limits: CompiledChannelAccount["limits"]) {
  let now = 0;
  const sent: string[] = [];
  const instance = new OutboundPacer({
    account: account(limits),
    logger: { warn: () => undefined },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const post = instance.paced(async (params: { to: string; text: string }) => {
    sent.push(`${params.to}:${params.text}@${String(now)}`);
    return { ok: true };
  });
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
});

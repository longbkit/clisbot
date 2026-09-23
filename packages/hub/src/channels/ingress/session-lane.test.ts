import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { toolActivityDefaults } from "../config/compile.js";
import type { InboundMessage } from "../plane/types.js";
import { sessionLaneKey } from "./session-lane.js";

const OPENER_TS = "1712000000.000700";

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  inbound: { reactionNotifications: "off", editNotifications: "off" },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: toolActivityDefaults(false),
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

function route(
  defaults: Partial<EffectiveDefaults>,
  where: CompiledRoute["where"] = { dm: true, groups: ["all"], conversations: [] },
): CompiledRoute {
  return {
    audienceRules: [],
    where,
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: { ...DEFAULTS, ...defaults },
    approval: [],
  };
}

function account(...routes: CompiledRoute[]): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: "work",
    enabled: true,
    channelEnabled: true,
    connectionId: "connection-id",
    transport: {},
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    routes,
  };
}

function inbound(
  conversation: Partial<InboundMessage["conversation"]> = {},
  externalMessageId = OPENER_TS,
): InboundMessage {
  return {
    channel: "slack",
    accountId: "work",
    senderIdentity: "slack:U0ALICE",
    text: "hello",
    mentionedBot: true,
    externalMessageId,
    conversation: {
      kind: "channel",
      id: "C0APP",
      rootConversationId: "C0APP",
      threadId: null,
      ...conversation,
    },
  };
}

const reply = inbound({ kind: "thread", id: OPENER_TS, threadId: OPENER_TS }, "1712000000.000800");

describe("session lane key", () => {
  it("gives a thread-anchored top-level message the lane its thread's replies use", () => {
    const threaded = account(route({}));
    assert.equal(sessionLaneKey(threaded, inbound()), `slack:work:C0APP:${OPENER_TS}`);
    assert.equal(sessionLaneKey(threaded, reply), `slack:work:C0APP:${OPENER_TS}`);
  });

  it("keeps the shared root lane where the session is shared", () => {
    const perChannel = account(route({ bindingKey: "channel" }));
    assert.equal(sessionLaneKey(perChannel, inbound()), "slack:work:C0APP:root");
    assert.equal(sessionLaneKey(perChannel, reply), "slack:work:C0APP:root");
    const rootAnchored = account(route({ replyAnchor: "default" }));
    assert.equal(sessionLaneKey(rootAnchored, inbound()), "slack:work:C0APP:root");
    const dm = inbound({ kind: "dm", id: "D0ALICE", rootConversationId: "D0ALICE" });
    assert.equal(sessionLaneKey(account(route({})), dm), "slack:work:D0ALICE:root");
  });

  it("leaves the transport's lane when the Routes do not settle the session", () => {
    const tiers = account(route({}), route({ bindingKey: "channel" }));
    assert.equal(sessionLaneKey(tiers, inbound()), undefined);
    const elsewhere = account(route({}, { dm: false, groups: [], conversations: ["C0OTHER"] }));
    assert.equal(sessionLaneKey(elsewhere, inbound()), undefined);
  });

  it("runs concurrent root slash commands that act on no session in lanes of their own", () => {
    const threaded = account(route({}));
    // A native Slack slash command carries its trigger_id, not a message ts.
    const first = sessionLaneKey(threaded, inbound({}, "13345.trigger-a"), "status");
    const second = sessionLaneKey(threaded, inbound({}, "13345.trigger-b"), "help");
    assert.equal(first, "slack:work:C0APP:event:13345.trigger-a");
    assert.equal(second, "slack:work:C0APP:event:13345.trigger-b");
    // One that can start or change the root binding keeps that binding's lane.
    assert.equal(
      sessionLaneKey(threaded, inbound({}, "13345.trigger-c"), "new"),
      "slack:work:C0APP:root",
    );
  });

  it("keeps a command with the session it acts on", () => {
    const perChannel = account(route({ bindingKey: "channel" }));
    assert.equal(
      sessionLaneKey(perChannel, inbound({}, "13345.trigger-a"), "status"),
      "slack:work:C0APP:root",
    );
    assert.equal(
      sessionLaneKey(perChannel, inbound({}, "13345.trigger-b"), "stop"),
      "slack:work:C0APP:root",
    );
    // "@bot /status" typed in a thread is a message of that thread.
    assert.equal(
      sessionLaneKey(account(route({})), reply, "status"),
      `slack:work:C0APP:${OPENER_TS}`,
    );
    const dm: InboundMessage = {
      ...inbound({ kind: "dm", id: "4242", rootConversationId: "4242" }, "77"),
      channel: "telegram",
      senderIdentity: "telegram:4242",
    };
    assert.equal(sessionLaneKey(account(route({})), dm, "status"), "telegram:work:4242:root");
  });
});

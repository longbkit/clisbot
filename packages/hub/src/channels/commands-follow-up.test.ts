import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { ChannelConversationKey } from "../db/channel-access.js";
import type { ChannelStore } from "../db/channels.js";
import { channelCommandPrivilege, parseChannelTextCommand } from "./commands.js";
import { parseFollowUpArguments } from "./commands-follow-up-arguments.js";
import { runFollowUpCommand } from "./commands-follow-up.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import { compileChannelControlPlane } from "./config/compile.js";
import type { InboundMessage } from "./plane/types.js";
import type { ChannelPlaneDeps } from "./plane/types.js";
import type { RouteDefaultPublisher, RouteFollowUpOutcome } from "./route-defaults/publish.js";

const ACCOUNT = `
channel: slack
accountId: support
enabled: true
connectionId: slack-support
transport: { mode: socket, errorPolicy: once }
routes:
  - match: { kind: channel, ids: [C1] }
    agent: assistant
    environment: lab
    interaction: { requireMention: true, followUp: { mode: mention-only, ttlMinutes: 5 } }
    reply: { anchor: thread }
  - match: { kind: dm }
    agent: assistant
    environment: lab
fallback: { deny: true }
`;

const THREAD: InboundMessage["conversation"] = {
  kind: "thread",
  id: "1712000000.000100",
  rootConversationId: "C1",
  threadId: "1712000000.000100",
};

function harness(
  options: {
    conversation?: InboundMessage["conversation"];
    route?: 0 | 1;
    manager?: boolean;
    outcome?: RouteFollowUpOutcome;
  } = {},
) {
  const plane = compileChannelControlPlane({
    files: [
      { path: ".paseo/channels/policy.yml", content: "defaults: {}\n" },
      { path: ".paseo/channels/slack/support.yml", content: ACCOUNT },
    ],
    agentNames: ["assistant"],
    environmentNames: ["lab"],
    workflowNames: [],
  });
  const account = plane.accounts[0]!;
  const context: LifecycleCommandContext = {
    message: {
      channel: "slack",
      accountId: "support",
      senderIdentity: "slack:UADMIN",
      text: "/followup",
      mentionedBot: true,
      externalMessageId: "1712000000.000300",
      conversation: options.conversation ?? THREAD,
    },
    account,
    route: account.routes[options.route ?? 0]!,
    accessTarget: { daemonReference: "daemon" },
    post: async () => true,
  };
  const publisher: RouteDefaultPublisher = {
    promote: vi.fn(),
    undo: vi.fn(),
    setFollowUp: vi.fn(
      async (_target, change) =>
        options.outcome ?? { status: "published" as const, followUp: { ttlMinutes: 5, ...change } },
    ),
    apply: vi.fn(),
  };
  const overrides = new Map<string, unknown>();
  const keyOf = (key: ChannelConversationKey) => JSON.stringify(key);
  const access = {
    findConversationFollowUp: vi.fn(async (key: ChannelConversationKey) =>
      overrides.get(keyOf(key)),
    ),
    setConversationFollowUp: vi.fn(async (key: ChannelConversationKey, input: unknown) => {
      overrides.set(keyOf(key), input);
    }),
    clearConversationFollowUp: vi.fn(async (key: ChannelConversationKey) => {
      overrides.delete(keyOf(key));
    }),
  };
  const deps = {
    plane: {
      organizationId: "org",
      routeDefaults: publisher,
      commandAccess: {
        authorizeChannelAccountManagement: async () =>
          options.manager === false ? undefined : { membershipId: "m", userId: "u" },
      },
    } as unknown as ChannelPlaneDeps,
    store: { access } as unknown as Pick<ChannelStore, "access">,
  };
  const run = (value?: string) => runFollowUpCommand({ ...deps, context, value });
  return { run, publisher, access };
}

describe("/followup arguments", () => {
  it("parses the conversation and route forms", () => {
    assert.deepEqual(parseFollowUpArguments(undefined), {
      scope: "conversation",
      action: "status",
    });
    assert.deepEqual(parseFollowUpArguments("Pause"), {
      scope: "conversation",
      action: "set",
      mode: "paused",
    });
    assert.deepEqual(parseFollowUpArguments("route"), { scope: "route", action: "status" });
    assert.deepEqual(parseFollowUpArguments("route auto 10"), {
      scope: "route",
      action: "set",
      change: { mode: "auto", ttlMinutes: 10 },
    });
    assert.deepEqual(parseFollowUpArguments("route mention-only"), {
      scope: "route",
      action: "set",
      change: { mode: "mention-only" },
    });
  });

  it("rejects anything else, so prose is not taken for the command", () => {
    for (const value of ["sometimes", "on the PR", "auto 10", "route auto 0", "route pause"]) {
      assert.equal(parseFollowUpArguments(value), null, value);
    }
    assert.equal(parseChannelTextCommand("followup on the PR review"), null);
    assert.deepEqual(parseChannelTextCommand("/followup route auto 10"), {
      name: "followup",
      value: "route auto 10",
    });
  });

  it("needs channel.manage only to change the route", () => {
    assert.equal(channelCommandPrivilege({ name: "followup", value: "auto" }), "agent.interact");
    assert.equal(channelCommandPrivilege({ name: "followup", value: "route" }), "agent.interact");
    assert.equal(
      channelCommandPrivilege({ name: "followup", value: "route auto" }),
      "channel.manage",
    );
  });
});

describe("/followup", () => {
  it("names the scope it changed", async () => {
    const { run, access } = harness();
    assert.match((await run("auto")).text, /^Follow-up for this thread set to `auto`/u);
    assert.equal(access.setConversationFollowUp.mock.calls.length, 1);
    assert.match((await run()).text, /^Follow-up for this thread: `auto`/u);
  });

  it("refuses at a channel root that would open the command's own thread", async () => {
    const root = { kind: "channel", id: "C1", rootConversationId: "C1", threadId: null } as const;
    const { run, access } = harness({ conversation: root });
    assert.match((await run("auto")).text, /Run \/followup inside the thread/u);
    assert.equal(access.setConversationFollowUp.mock.calls.length, 0);
    assert.match((await run()).text, /^Follow-up for route #1/u);
  });

  it("refuses a change where every message is already answered", async () => {
    const dm = { kind: "dm", id: "U1", rootConversationId: "D1", threadId: null } as const;
    const { run, access } = harness({ conversation: dm, route: 1 });
    assert.match((await run("auto")).text, /^Follow-up has no effect here/u);
    assert.equal(access.setConversationFollowUp.mock.calls.length, 0);
  });

  it("publishes a route change and asks the caller to apply it", async () => {
    const { run, publisher } = harness();
    const result = await run("route auto 10");
    assert.equal(result.published, true);
    assert.match(result.text, /^Follow-up for route #1 .*set to `auto` \(10 minutes/u);
    assert.deepEqual(vi.mocked(publisher.setFollowUp).mock.calls[0]?.[1], {
      mode: "auto",
      ttlMinutes: 10,
    });
  });

  it("does not change the route without channel.manage or after it moved", async () => {
    const denied = await harness({ manager: false }).run("route mention-only");
    assert.deepEqual(denied, {
      text: "/followup route requires channel.manage access here.",
      published: false,
    });
    const moved = await harness({ outcome: { status: "route_changed" } }).run("route auto");
    assert.equal(moved.published, false);
    assert.match(moved.text, /changed since this message arrived/u);
  });
});

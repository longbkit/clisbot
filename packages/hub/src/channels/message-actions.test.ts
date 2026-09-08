// The Hub's edge of the ported message-action layer, under concurrency.
//
// One Hub process serves every account of every organization, so two `message`
// tool calls are routinely in flight together. Core's plugin discovery and its
// durable sender are both host-installed singletons upstream; these tests hold
// two calls open at the same time and assert each one keeps its own plugin and
// its own outbound seam — a cross-tenant send would post into the other
// conversation, and the later call's teardown would uninstall the earlier
// call's sender.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  clearChannelMessageActions,
  registerChannelMessageActions,
  runChannelMessageAction,
  type ChannelMessageActionRequest,
} from "./message-actions.js";

interface Handled {
  channel: string;
  action: string;
  accountId: string | null;
  target: unknown;
  threadId?: unknown;
  requesterSenderId?: string | undefined;
}

/** Holds every arrival until `count` calls are in flight together. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let open = (): void => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) open();
    await gate;
  };
}

const ORGANIZATION_ID = "org-1";

/** The organization-scoped account the Hub keys every registry by. */
function scope(channel: string, accountId: string) {
  return { organizationId: ORGANIZATION_ID, channel, accountId };
}

/** Registers a vertical whose `handleAction` records the call it was given. */
function installAdapter(
  channel: string,
  accountId: string,
  handled: Handled[],
  gate: () => Promise<void>,
): void {
  registerChannelMessageActions(scope(channel, accountId), {
    messageActions: {
      describeMessageTool: () => ({ actions: ["send", "react"], capabilities: [] }),
      handleAction: async (ctx: {
        channel: string;
        action: string;
        accountId?: string | null;
        params: Record<string, unknown>;
        requesterSenderId?: string;
      }) => {
        // Both calls are now inside the vertical at the same time.
        await gate();
        handled.push({
          channel: ctx.channel,
          action: ctx.action,
          accountId: ctx.accountId ?? null,
          target: ctx.params["target"],
          threadId: ctx.params["threadId"],
          requesterSenderId: ctx.requesterSenderId,
        });
        return {
          content: [{ type: "text", text: `${channel}/${accountId} did ${ctx.action}` }],
          details: { ok: true, messageId: `${accountId}-1` },
        };
      },
    },
  });
}

/** One account's request, with a send seam that records what it was asked to post. */
function request(
  channel: string,
  accountId: string,
  action: string,
  posts: Array<{ to: string; text: string }>,
  gate: () => Promise<void>,
  params: Record<string, unknown> = {},
): ChannelMessageActionRequest {
  return {
    ...scope(channel, accountId),
    action,
    params,
    conversation: { to: `conversation-${accountId}` },
    send: async ({ to, text }) => {
      // Both sends are now at the outbound seam at the same time.
      await gate();
      posts.push({ to, text });
      return { ok: true, externalMessageId: `${accountId}-posted` };
    },
  };
}

describe("concurrent channel message actions", () => {
  afterEach(() => {
    clearChannelMessageActions(scope("slack", "org-a"));
    clearChannelMessageActions(scope("telegram", "org-b"));
  });

  it("gives each in-flight call its own outbound seam", async () => {
    const gate = barrier(2);
    const postsA: Array<{ to: string; text: string }> = [];
    const postsB: Array<{ to: string; text: string }> = [];
    const [a, b] = await Promise.all([
      runChannelMessageAction(
        request("slack", "org-a", "send", postsA, gate, { message: "for A" }),
      ),
      runChannelMessageAction(
        request("telegram", "org-b", "send", postsB, gate, { message: "for B" }),
      ),
    ]);
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    assert.deepEqual(postsA, [{ to: "conversation-org-a", text: "for A" }]);
    assert.deepEqual(postsB, [{ to: "conversation-org-b", text: "for B" }]);
    assert.equal(a.messageId, "org-a-posted");
    assert.equal(b.messageId, "org-b-posted");
  });

  it("gives each in-flight call its own vertical adapter", async () => {
    const gate = barrier(2);
    const handledA: Handled[] = [];
    const handledB: Handled[] = [];
    installAdapter("slack", "org-a", handledA, gate);
    installAdapter("telegram", "org-b", handledB, gate);
    const params = { messageId: "m-1", emoji: "eyes" };
    const [a, b] = await Promise.all([
      runChannelMessageAction(request("slack", "org-a", "react", [], gate, params)),
      runChannelMessageAction(request("telegram", "org-b", "react", [], gate, params)),
    ]);
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    for (const [handled, channel, accountId] of [
      [handledA, "slack", "org-a"],
      [handledB, "telegram", "org-b"],
    ] as const) {
      assert.equal(handled.length, 1);
      assert.equal(handled[0]?.channel, channel);
      assert.equal(handled[0]?.action, "react");
      assert.equal(handled[0]?.accountId, accountId);
      assert.equal(handled[0]?.target, `conversation-${accountId}`);
    }
    assert.equal(a.toolText, "slack/org-a did react");
    assert.equal(b.toolText, "telegram/org-b did react");
  });
});

// What the Hub will and will not address with a capability's binding.
//
// Every fact that decides WHERE an action lands is the Hub's: the target, the
// thread and the requester come from the binding, and an action whose subject
// is a resource somewhere else is not run at all. These cases hold a stand-in
// vertical so the assertion is about the Hub's edge, not one provider's API.

/** A vertical that advertises everything asked of it and records each call. */
function installRecordingAdapter(
  channel: string,
  accountId: string,
  handled: Handled[],
  actions: readonly string[] = ["send", "react", "download-file", "search"],
): void {
  registerChannelMessageActions(scope(channel, accountId), {
    messageActions: {
      describeMessageTool: () => ({ actions: [...actions], capabilities: [] }),
      handleAction: async (ctx: {
        channel: string;
        action: string;
        accountId?: string | null;
        params: Record<string, unknown>;
        requesterSenderId?: string;
      }) => {
        handled.push({
          channel: ctx.channel,
          action: ctx.action,
          accountId: ctx.accountId ?? null,
          target: ctx.params["target"],
          threadId: ctx.params["threadId"],
          requesterSenderId: ctx.requesterSenderId,
        });
        return { content: [{ type: "text", text: "ok" }], details: { ok: true } };
      },
    },
  });
}

describe("the Hub's binding decides what an action may address", () => {
  const handled: Handled[] = [];
  const ACCOUNT = "binding";

  beforeEach(() => {
    handled.length = 0;
    installRecordingAdapter("telegram", ACCOUNT, handled);
  });

  afterEach(() => {
    clearChannelMessageActions(scope("telegram", ACCOUNT));
    forgetChannelMessageToolCatalog(scope("telegram", ACCOUNT));
  });

  function bound(
    action: string,
    params: Record<string, unknown>,
    conversation: { to: string; threadId?: string } = { to: "chat-1" },
  ): ChannelMessageActionRequest {
    return {
      ...scope("telegram", ACCOUNT),
      action,
      params,
      conversation,
      requesterSenderId: "42",
      send: async () => ({ ok: true, externalMessageId: "sent-1" }),
    };
  }

  it("refuses an action the binding cannot address, before the vertical sees it", async () => {
    for (const action of ["download-file", "search"]) {
      const outcome = await runChannelMessageAction(bound(action, { fileId: "F0THERS" }));
      assert.equal(outcome.ok, false);
      assert.equal(outcome.handledBy, "hub");
      assert.match(outcome.error ?? "", /outside this conversation/u);
      assert.deepEqual(outcome.payload, {
        ok: false,
        status: "unbindable_action",
        action,
        reason: outcome.error,
      });
    }
    assert.deepEqual(handled, []);
  });

  it("drops a model-supplied thread from a conversation bound at the root", async () => {
    // A Telegram topic id the capability was never bound to: the action must
    // land in the bound conversation, not in the topic the model named.
    const outcome = await runChannelMessageAction(bound("react", { messageId: 7, threadId: "99" }));
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(handled[0]?.threadId, undefined);
  });

  it("writes the binding's own thread over the model's", async () => {
    const outcome = await runChannelMessageAction(
      bound("react", { messageId: 7, threadId: "99" }, { to: "chat-1", threadId: "77" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(handled[0]?.threadId, "77");
  });

  it("hands the vertical the capability's requester, never the model's", async () => {
    const outcome = await runChannelMessageAction(
      bound("react", { messageId: 7, requesterSenderId: "999" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(handled[0]?.requesterSenderId, "42");
  });

  it("does not advertise an action the binding cannot address", () => {
    const advertised = listChannelMessageToolActions("telegram", scope("telegram", ACCOUNT));
    const executable = listExecutableMessageActions("telegram", scope("telegram", ACCOUNT));
    assert.ok(advertised.includes("react"), advertised.join());
    for (const action of ["download-file", "search"]) {
      assert.ok(!advertised.includes(action), `${action} is advertised: ${advertised.join()}`);
      assert.ok(!executable.includes(action), `${action} is executable: ${executable.join()}`);
    }
  });
});

// The Telegram vertical, end to end over the Hub seam.
//
// The concurrency cases above use a stand-in adapter. These run the real ported
// vertical: `runChannelMessageAction` → core's runner → `dispatchChannelMessageAction`
// → `telegramMessageActions.handleAction` → `handleTelegramAction` → the ported
// `send-*.ts` primitives → grammY's `Api`. Only that last object is faked, through
// upstream's own `TelegramApiCallOpts.api` seam (the same seam the ported
// `typing.test.ts` uses), so every Bot API method name and parameter asserted below
// is the one the vertical would put on the wire.
//
// The vertical is imported from its build output because `@getpaseo/channels-telegram`
// is a workspace sibling the Hub loads at runtime rather than a declared dependency;
// `npm run build --workspace=@getpaseo/channels-telegram` must have run.
import { telegramActionRuntime } from "@getpaseo/channels-telegram/dist/action-runtime.js";
import { telegramMessageActions } from "@getpaseo/channels-telegram/dist/channel-actions.js";

interface BotApiCall {
  method: string;
  args: unknown[];
}

/** The grammY `Api` surface the asserted actions reach, recording every call. */
function createFakeBotApi(calls: BotApiCall[]) {
  const record =
    (method: string, result: (args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result(args);
    };
  const chat = { id: -1002200300400, type: "supergroup", is_forum: true };
  return {
    getChat: async () => chat,
    setMessageReaction: record("setMessageReaction", () => true),
    deleteMessage: record("deleteMessage", () => true),
    editMessageText: record("editMessageText", () => ({
      message_id: 4242,
      chat,
      text: "edited",
    })),
    sendPoll: record("sendPoll", (args) => ({
      message_id: 5150,
      chat,
      poll: { id: "poll-9", question: String(args[1]) },
      ...(typeof (args[3] as { message_thread_id?: number })?.message_thread_id === "number"
        ? {
            message_thread_id: (args[3] as { message_thread_id: number }).message_thread_id,
            is_topic_message: true,
          }
        : {}),
    })),
    createForumTopic: record("createForumTopic", (args) => ({
      message_thread_id: 8080,
      name: String(args[1]),
    })),
  };
}

/**
 * Routes every action-runtime send primitive through the fake `Api`.
 *
 * `handleTelegramAction` calls these through the `telegramActionRuntime` indirection
 * upstream exports for exactly this purpose; wrapping them adds the `api` override
 * to the options the real primitive already accepts, so the primitive itself — target
 * parsing, thread params, reaction normalization, poll normalization — still runs.
 */
function withFakeBotApi(api: unknown): () => void {
  const original = { ...telegramActionRuntime };
  const withApi = (options: unknown) => ({ ...(options as Record<string, unknown>), api });
  Object.assign(telegramActionRuntime, {
    reactMessageTelegram: (chatId: never, messageId: never, emoji: never, options: unknown) =>
      original.reactMessageTelegram(chatId, messageId, emoji, withApi(options) as never),
    deleteMessageTelegram: (chatId: never, messageId: never, options: unknown) =>
      original.deleteMessageTelegram(chatId, messageId, withApi(options) as never),
    editMessageTelegram: (chatId: never, messageId: never, text: never, options: unknown) =>
      original.editMessageTelegram(chatId, messageId, text, withApi(options) as never),
    sendPollTelegram: (to: never, poll: never, options: unknown) =>
      original.sendPollTelegram(to, poll, withApi(options) as never),
    createForumTopicTelegram: (chatId: never, name: never, options: unknown) =>
      original.createForumTopicTelegram(chatId, name, withApi(options) as never),
  });
  return () => {
    Object.assign(telegramActionRuntime, original);
  };
}

const TELEGRAM_CHAT = "-1002200300400";

/** One Hub request for the Telegram account, with a send seam nothing here should reach. */
function telegramRequest(
  action: string,
  params: Record<string, unknown>,
  conversation: { to: string; threadId?: string } = { to: TELEGRAM_CHAT },
): ChannelMessageActionRequest {
  return {
    ...scope("telegram", "default"),
    action,
    params,
    conversation,
    send: async () => {
      throw new Error("Non-send actions must not reach the Hub outbound seam.");
    },
  };
}

describe("Telegram message actions over the Hub seam", () => {
  let calls: BotApiCall[];
  let restoreApi: () => void;
  let previousToken: string | undefined;

  beforeEach(() => {
    calls = [];
    restoreApi = withFakeBotApi(createFakeBotApi(calls));
    previousToken = process.env["TELEGRAM_BOT_TOKEN"];
    // The Hub resolves credentials and hands the vertical a drive-time config; this
    // suite drives the runner directly, so the default account reads the env token
    // the ported `account-inspect.ts` falls back to.
    process.env["TELEGRAM_BOT_TOKEN"] = "123456:hub-seam-test-token";
    registerChannelMessageActions(scope("telegram", "default"), {
      messageActions: telegramMessageActions,
    });
  });

  afterEach(() => {
    restoreApi();
    clearChannelMessageActions(scope("telegram", "default"));
    if (previousToken === undefined) delete process.env["TELEGRAM_BOT_TOKEN"];
    else process.env["TELEGRAM_BOT_TOKEN"] = previousToken;
  });

  function callOf(method: string): BotApiCall {
    const call = calls.find((entry) => entry.method === method);
    assert.ok(call, `expected a ${method} Bot API call, saw ${JSON.stringify(calls)}`);
    return call;
  }

  it("reacts to a message with the requested emoji", async () => {
    const outcome = await runChannelMessageAction(
      telegramRequest("react", { messageId: 4242, emoji: "👍" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    const call = callOf("setMessageReaction");
    assert.equal(call.args[0], TELEGRAM_CHAT);
    assert.equal(call.args[1], 4242);
    assert.deepEqual(call.args[2], [{ type: "emoji", emoji: "👍" }]);
  });

  it("edits a message in place", async () => {
    const outcome = await runChannelMessageAction(
      telegramRequest("edit", { messageId: 4242, message: "edited body" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    const call = callOf("editMessageText");
    assert.equal(call.args[0], TELEGRAM_CHAT);
    assert.equal(call.args[1], 4242);
    assert.equal(call.args[2], "edited body");
  });

  it("deletes a message", async () => {
    const outcome = await runChannelMessageAction(telegramRequest("delete", { messageId: 4242 }));
    assert.equal(outcome.ok, true, outcome.error);
    const call = callOf("deleteMessage");
    assert.equal(call.args[0], TELEGRAM_CHAT);
    assert.equal(call.args[1], 4242);
  });

  it("sends a poll into the bound forum topic", async () => {
    const outcome = await runChannelMessageAction(
      telegramRequest(
        "poll",
        { question: "Ship it?", answers: ["yes", "no", "later"] },
        { to: TELEGRAM_CHAT, threadId: "77" },
      ),
    );
    assert.equal(outcome.ok, true, outcome.error);
    const call = callOf("sendPoll");
    assert.equal(call.args[0], TELEGRAM_CHAT);
    assert.equal(call.args[1], "Ship it?");
    assert.deepEqual(call.args[2], ["yes", "no", "later"]);
    const params = call.args[3] as { message_thread_id?: number; is_anonymous?: boolean };
    assert.equal(params.message_thread_id, 77);
    assert.equal(params.is_anonymous, true);
  });

  it("creates a forum topic", async () => {
    const outcome = await runChannelMessageAction(
      telegramRequest("topic-create", { name: "release-2026-09" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    const call = callOf("createForumTopic");
    assert.equal(call.args[0], TELEGRAM_CHAT);
    assert.equal(call.args[1], "release-2026-09");
  });

  it("refuses an action the vertical does not implement", async () => {
    // `pin` is a core action name Telegram's map does not carry, so the vertical
    // refuses it by name before any Bot API call is made.
    await assert.rejects(
      runChannelMessageAction(telegramRequest("pin", { messageId: 4242 })),
      /Unsupported Telegram action: pin/,
    );
    assert.deepEqual(calls, []);
  });
});

// The Slack vertical, end to end over the Hub seam (D-W4-02).
//
// Wave 4 found every non-`send` Slack action refused live while Telegram's
// adapter dispatched `edit` and `poll` on the same build. The two verticals
// differ in how their `describeMessageTool` reads the account: Telegram falls
// back to an unscoped, default-on gate when no account is named, while Slack
// enumerates the accounts the `cfg` carries and advertises nothing when it
// carries none. The Hub used to run discovery with an empty `cfg` and no
// account, so Slack's advertised set collapsed to `send` and every other action
// was refused before it ever reached the vertical.
//
// These cases drive the real built Slack dist: `listExecutableMessageActions`
// over the account's registered adapter, then `runChannelMessageAction` →
// core's runner → `slackMessageActions.handleAction` → `handleSlackAction` →
// the ported `actions.ts` primitives → `@slack/web-api`. Only that last object
// is faked, through upstream's own `SlackActionClientOpts.client` seam, so
// every Web API method and payload asserted below is what the vertical would
// put on the wire.
import { slackActionRuntime } from "@getpaseo/channels-slack/dist/action-runtime.js";
import { slackPlugin } from "@getpaseo/channels-slack/dist/plugin.js";
import {
  forgetChannelMessageToolCatalog,
  listChannelMessageToolActions,
  listExecutableMessageActions,
} from "./channel-message-tool.js";
import { registerChannelDriveConfig } from "./message-actions.js";

const SLACK_ACCOUNT = "wave-4";
const SLACK_SCOPE = { organizationId: ORGANIZATION_ID, channel: "slack", accountId: SLACK_ACCOUNT };
const SLACK_CHANNEL = "C0SLICE12";
const SLACK_MESSAGE_TS = "1788777131.264409";

/** The drive-time cfg the supervisor registers for a Slack account
 * (`accountAndCfg` + the Slack account carrier). */
const SLACK_DRIVE_CFG = {
  channels: {
    slack: {
      accounts: {
        [SLACK_ACCOUNT]: {
          botToken: "xoxb-hub-seam-test-token",
          appToken: "xapp-hub-seam-test-token",
          config: {},
        },
      },
    },
  },
};

interface WebApiCall {
  method: string;
  args: unknown[];
}

/** The `@slack/web-api` surface the asserted actions reach, recording every call. */
function createFakeWebClient(calls: WebApiCall[]) {
  const record =
    (method: string, result: () => unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result();
    };
  return {
    auth: { test: async () => ({ ok: true, user_id: "UBOT" }) },
    reactions: { add: record("reactions.add", () => ({ ok: true })) },
    chat: {
      update: record("chat.update", () => ({
        ok: true,
        channel: SLACK_CHANNEL,
        ts: SLACK_MESSAGE_TS,
      })),
    },
    pins: { add: record("pins.add", () => ({ ok: true })) },
  };
}

/**
 * Routes the asserted action-runtime primitives through the fake Web client.
 *
 * `handleSlackAction` calls them through the `slackActionRuntime` indirection
 * upstream exports for exactly this purpose; wrapping them adds `client` to the
 * `SlackActionClientOpts` the real primitive already accepts, so the primitive
 * itself — target parsing, emoji normalization, edit-payload rendering — still
 * runs.
 *
 * `resolveSlackConversationInfo` is the one primitive replaced outright rather
 * than wrapped: it is the `conversations.info` read upstream's read-target gate
 * makes before every write, and it builds its own lookup client from the token
 * with no injection seam. The vertical's own `action-runtime.test.ts` stubs it
 * the same way.
 */
function withFakeWebClient(client: unknown): () => void {
  const original = { ...slackActionRuntime };
  const withClient = (opts: unknown) => ({ ...(opts as Record<string, unknown>), client });
  Object.assign(slackActionRuntime, {
    reactSlackMessage: (channelId: never, messageId: never, emoji: never, opts: unknown) =>
      original.reactSlackMessage(channelId, messageId, emoji, withClient(opts) as never),
    editSlackMessage: (channelId: never, messageId: never, content: never, opts: unknown) =>
      original.editSlackMessage(channelId, messageId, content, withClient(opts) as never),
    pinSlackMessage: (channelId: never, messageId: never, opts: unknown) =>
      original.pinSlackMessage(channelId, messageId, withClient(opts) as never),
    resolveSlackConversationInfo: async () => ({ type: "channel", name: "slice-12" }),
  });
  return () => {
    Object.assign(slackActionRuntime, original);
  };
}

/** One Hub request for the Slack account, with a send seam nothing here reaches. */
function slackRequest(
  action: string,
  params: Record<string, unknown>,
): ChannelMessageActionRequest {
  return {
    ...SLACK_SCOPE,
    action,
    params,
    conversation: { to: SLACK_CHANNEL },
    send: async () => {
      throw new Error("Non-send actions must not reach the Hub outbound seam.");
    },
  };
}

describe("Slack message actions over the Hub seam", () => {
  let calls: WebApiCall[];
  let restoreRuntime: () => void;

  beforeEach(() => {
    calls = [];
    restoreRuntime = withFakeWebClient(createFakeWebClient(calls));
    // The real built vertical, registered exactly as `load-channel.ts` does:
    // the whole plugin object, read under upstream's `actions` spelling.
    registerChannelMessageActions(SLACK_SCOPE, slackPlugin as never);
    registerChannelDriveConfig(SLACK_SCOPE, SLACK_DRIVE_CFG);
    forgetChannelMessageToolCatalog(SLACK_SCOPE);
  });

  afterEach(() => {
    restoreRuntime();
    clearChannelMessageActions(SLACK_SCOPE);
    forgetChannelMessageToolCatalog(SLACK_SCOPE);
  });

  function callOf(method: string): WebApiCall {
    const call = calls.find((entry) => entry.method === method);
    assert.ok(call, `expected a ${method} Web API call, saw ${JSON.stringify(calls)}`);
    return call;
  }

  it("advertises and can execute the account's whole action set", () => {
    const advertised = listChannelMessageToolActions("slack", SLACK_SCOPE);
    const executable = listExecutableMessageActions("slack", SLACK_SCOPE);
    for (const action of ["send", "react", "edit", "pin", "unpin", "read"]) {
      assert.ok(advertised.includes(action), `${action} is not advertised: ${advertised.join()}`);
      assert.ok(executable.includes(action), `${action} is not executable: ${executable.join()}`);
    }
  });

  it("reacts to a message with the requested emoji", async () => {
    const outcome = await runChannelMessageAction(
      slackRequest("react", { messageId: SLACK_MESSAGE_TS, emoji: "eyes" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(callOf("reactions.add").args[0], {
      channel: SLACK_CHANNEL,
      timestamp: SLACK_MESSAGE_TS,
      name: "eyes",
    });
  });

  it("edits a message in place", async () => {
    const outcome = await runChannelMessageAction(
      slackRequest("edit", { messageId: SLACK_MESSAGE_TS, message: "edited body" }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    const update = callOf("chat.update").args[0] as { channel: string; ts: string; text: string };
    assert.equal(update.channel, SLACK_CHANNEL);
    assert.equal(update.ts, SLACK_MESSAGE_TS);
    assert.equal(update.text, "edited body");
  });

  // The host read gate, on a vertical that claims its provider owns it.
  //
  // `slackMessageActions` sets `providerOwnedReadGates: true`, which upstream
  // honours for a bundled registration: core's dispatcher then skips
  // `enforceMessageActionConversationReadGate` and hands the call straight to
  // the vertical. Upstream can afford that — a Gateway enforces the read
  // boundary behind it. Fusion runs no Gateway, so the Hub strips the flag
  // (`corePlugin`) and the host gate is the only thing between a conversation
  // id the model wrote and a read of it. With the flag honoured this call
  // reached `handleAction` with the foreign id still in its params.
  it("refuses a read aimed at a conversation the capability is not bound to", async () => {
    await assert.rejects(
      runChannelMessageAction(slackRequest("read", { chatId: "C0FOREIGN", limit: 5 })),
      /requires the exact current conversation/u,
    );
    // Refused at the host boundary: nothing reached the Slack Web API.
    assert.deepEqual(calls, []);
  });

  it("pins a message", async () => {
    const outcome = await runChannelMessageAction(
      slackRequest("pin", { messageId: SLACK_MESSAGE_TS }),
    );
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(callOf("pins.add").args[0], {
      channel: SLACK_CHANNEL,
      timestamp: SLACK_MESSAGE_TS,
    });
  });
});

// --- Native media: an attachment's path from the Hub stager to the vertical ---
//
// In production the Hub stages each of a `send`'s attachments, posts one
// platform message per part through its outbound seam, and the supervisor's
// `mediaPostFor` hands the staged file to the loaded vertical's
// `outbound.sendMedia`. These cases stand in for the supervisor with that same
// call shape and run the REAL built vertical, faking only grammY's `Api` and
// Slack's `WebClient` — so the Bot API method each file type routes to, and the
// three-step Slack external upload, are the ones the vertical would put on the
// wire.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sendMedia as telegramSendMedia,
  sendText as telegramSendText,
} from "@getpaseo/channels-telegram/dist/outbound.js";
import {
  sendMedia as slackSendMedia,
  sendSlackText,
} from "@getpaseo/channels-slack/dist/outbound.js";
import {
  registerSlackWriteClientForTest,
  slackWebClientStubForTest,
  type WebClient,
} from "@getpaseo/channels-slack/dist/client/web-api.js";
import type { HostRuntime } from "./loader/host.js";
import { createChannelMediaStager } from "./media/outbound-stager.js";
import type { HubOutboundSendParams, HubOutboundSendResult } from "./message-actions.js";

/** The Hub host surface the Telegram vertical installs its account runtime over. */
const MEDIA_HOST_RUNTIME = {
  state: {
    openKeyedStore: () => ({
      register: async () => undefined,
      registerIfAbsent: async () => true,
      update: async () => true,
      lookup: async () => undefined,
      consume: async () => undefined,
      delete: async () => false,
      entries: async () => [],
      clear: async () => undefined,
    }),
  },
  logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
} as unknown as HostRuntime;

const TELEGRAM_MEDIA_CFG = {
  channels: { telegram: { accounts: { bot: { botToken: "123456:hub-media-token" } } } },
};
const SLACK_MEDIA_TOKEN = "xoxb-hub-media-token";
const SLACK_MEDIA_CFG = {
  channels: { slack: { accounts: { work: { botToken: SLACK_MEDIA_TOKEN } } } },
};

/** A Project holding the two attachments these cases send. */
async function mediaProject(prefix: string): Promise<{
  root: string;
  note: string;
  png: string;
  voice: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const note = join(root, "notes.txt");
  const png = join(root, "chart.png");
  const voice = join(root, "answer.ogg");
  await writeFile(note, "the notes");
  await writeFile(voice, Buffer.alloc(64, 3));
  // A real PNG signature and IHDR: upstream's dimension probe answers, so the
  // Telegram send takes the photo branch instead of the document fallback.
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(320, 16);
  bytes.writeUInt32BE(240, 20);
  await writeFile(png, bytes);
  return { root, note, png, voice };
}

/** Every Bot API send method the media routing can pick. */
function createFakeMediaApi(calls: BotApiCall[]): Record<string, unknown> {
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return { message_id: calls.length, chat: { id: -100200300, type: "supergroup" } };
    };
  return {
    sendMessage: record("sendMessage"),
    sendPhoto: record("sendPhoto"),
    sendDocument: record("sendDocument"),
    sendAnimation: record("sendAnimation"),
    sendVideo: record("sendVideo"),
    sendAudio: record("sendAudio"),
    sendVoice: record("sendVoice"),
    getChat: async () => ({ id: -100200300, type: "supergroup" }),
  };
}

/** The supervisor's `mediaPostFor`/`postFor` pair, against the real Telegram vertical. */
function telegramMediaSeam(
  api: Record<string, unknown>,
): (params: HubOutboundSendParams) => Promise<HubOutboundSendResult> {
  const base = {
    cfg: TELEGRAM_MEDIA_CFG as unknown as Record<string, unknown>,
    hostRuntime: MEDIA_HOST_RUNTIME,
    accountId: "bot",
    to: TELEGRAM_CHAT,
    api,
  };
  return async (params) => {
    if (params.media === undefined) {
      const sent = await telegramSendText({ ...base, text: params.text });
      return { ok: true, externalMessageId: String(sent.messageId) };
    }
    const sent = await telegramSendMedia({
      ...base,
      filePath: params.media.filePath,
      fileName: params.media.fileName,
      ...(params.media.mimeType === undefined ? {} : { mimeType: params.media.mimeType }),
      ...(params.media.asVoice === undefined ? {} : { asVoice: params.media.asVoice }),
    });
    return {
      ok: true,
      externalMessageId: String(sent.messageId),
      mediaPosted: sent.mediaPosted,
    };
  };
}

describe("native media over the Hub seam", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it("routes a Telegram send's text and two attachments to their own Bot API methods", async () => {
    const project = await mediaProject("hub-tg-media-");
    roots.push(project.root);
    const calls: BotApiCall[] = [];
    const outcome = await runChannelMessageAction({
      ...scope("telegram", "bot"),
      action: "send",
      params: {
        message: "two files",
        attachments: [{ media: project.note }, { media: project.png }],
      },
      conversation: { to: TELEGRAM_CHAT },
      stageMedia: createChannelMediaStager({
        channel: "telegram",
        projectRoot: project.root,
      }),
      send: telegramMediaSeam(createFakeMediaApi(calls)),
    });
    assert.equal(outcome.ok, true, outcome.error);
    // The body is its own message, then one message per file, in the order the
    // model wrote them; the file type picks the Bot API method.
    assert.deepEqual(
      calls.map((call) => call.method),
      ["sendMessage", "sendDocument", "sendPhoto"],
    );
    assert.deepEqual(
      outcome.deliveries?.map((delivery) => delivery.mediaPosted),
      [undefined, true, true],
    );
  });

  it("sends an audio attachment as a Telegram voice note when asVoice is set", async () => {
    const project = await mediaProject("hub-tg-voice-");
    roots.push(project.root);
    const calls: BotApiCall[] = [];
    const outcome = await runChannelMessageAction({
      ...scope("telegram", "bot"),
      action: "send",
      params: { attachments: [{ media: project.voice }], asVoice: true },
      conversation: { to: TELEGRAM_CHAT },
      stageMedia: createChannelMediaStager({
        channel: "telegram",
        projectRoot: project.root,
      }),
      send: telegramMediaSeam(createFakeMediaApi(calls)),
    });
    assert.equal(outcome.ok, true, outcome.error);
    // Without `asVoice` the same `.ogg` posts through `sendAudio`; the flag has
    // to survive core's send payload and the Hub's staging to change that.
    assert.deepEqual(
      calls.map((call) => call.method),
      ["sendVoice"],
    );
  });

  it("uploads a Slack send's two attachments through the three-step external upload", async () => {
    const project = await mediaProject("hub-slack-media-");
    roots.push(project.root);
    const posts: Array<{ text?: string }> = [];
    const uploads: Array<{ filename: string }> = [];
    const completes: Array<{ files: Array<{ id: string }> }> = [];
    const client = {
      ...slackWebClientStubForTest(),
      auth: {
        async test() {
          return { ok: true, user_id: "U_BOT" } as never;
        },
      },
      chat: {
        async postMessage(args: { text?: string }) {
          posts.push(args);
          return { ok: true, ts: `17888000.00000${posts.length}` } as never;
        },
        async update() {
          return { ok: true } as never;
        },
      },
      files: {
        async getUploadURLExternal(args: { filename: string }) {
          uploads.push(args);
          return {
            ok: true,
            upload_url: "https://files.slack.com/upload",
            file_id: `F${uploads.length}`,
          } as never;
        },
        async completeUploadExternal(args: { files: Array<{ id: string }> }) {
          completes.push(args);
          return { ok: true } as never;
        },
      },
    } as WebClient;
    registerSlackWriteClientForTest(SLACK_MEDIA_TOKEN, client);
    const realFetch = globalThis.fetch;
    // Step 2 of the upload POSTs the bytes to the capability-bearing URL.
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch;
    try {
      const outcome = await runChannelMessageAction({
        ...scope("slack", "work"),
        action: "send",
        params: {
          message: "two files",
          attachments: [{ media: project.note }, { media: project.png }],
        },
        conversation: { to: SLACK_CHANNEL },
        stageMedia: createChannelMediaStager({
          channel: "slack",
          projectRoot: project.root,
        }),
        send: async (params) => {
          const base = {
            cfg: SLACK_MEDIA_CFG as unknown as Record<string, unknown>,
            accountId: "work",
            to: SLACK_CHANNEL,
          };
          if (params.media === undefined) {
            const sent = await sendSlackText({ ...base, text: params.text, client } as never);
            return { ok: true, externalMessageId: String(sent.messageId) };
          }
          const sent = await slackSendMedia({
            ...base,
            filePath: params.media.filePath,
            fileName: params.media.fileName,
          });
          return {
            ok: true,
            externalMessageId: String(sent.messageId),
            mediaPosted: sent.mediaPosted,
          };
        },
      });
      assert.equal(outcome.ok, true, outcome.error);
      assert.deepEqual(
        posts.map((post) => post.text),
        ["two files"],
      );
      // One upload per attachment, each committed into the conversation under
      // the name the Hub staged it with.
      assert.deepEqual(
        uploads.map((upload) => upload.filename),
        ["notes.txt", "chart.png"],
      );
      assert.deepEqual(
        completes.map((complete) => complete.files[0]?.id),
        ["F1", "F2"],
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// --- The portable presentation over the Hub seam (wave 6b) -------------------
//
// Core materializes a `presentation` into fallback text before delivery unless
// the account's plugin declares that the channel renders one
// (`hasCorePresentationDelivery`), so the Hub's `corePlugin` carries the
// vertical's presentation outbound. These cases run the REAL built verticals
// against a fake Web API / Bot API: Slack's blocks reach `chat.postMessage` and
// Telegram's table reaches `sendRichMessage` as a native Bot API 10.3 `table`
// block (wave 6d, D-TG-057) — both verticals declare `presentationCapabilities`.
import { telegramPlugin } from "@getpaseo/channels-telegram/dist/plugin.js";

const SLACK_PRESENTATION_TOKEN = "xoxb-hub-presentation-token";
const SLACK_PRESENTATION_SCOPE = scope("slack", "present");
const SLACK_PRESENTATION_CFG = {
  channels: {
    slack: { accounts: { present: { botToken: SLACK_PRESENTATION_TOKEN, config: {} } } },
  },
};
const TELEGRAM_PRESENTATION_SCOPE = scope("telegram", "present");
// `richMessages` is the account's own opt-in to the Bot API 10.3 rich path,
// which is what a native `table` block needs (`presentation-outbound.ts`).
const TELEGRAM_PRESENTATION_CFG = {
  channels: {
    telegram: {
      accounts: { present: { botToken: "123456:hub-presentation", richMessages: true } },
    },
  },
};

/** The chart + table one `send` carries, in the portable block vocabulary. */
const CHART_AND_TABLE = {
  blocks: [
    {
      type: "chart",
      chartType: "bar",
      title: "Weekly runs",
      categories: ["Mon", "Tue", "Wed"],
      series: [{ name: "runs", values: [3, 5, 4] }],
    },
    { type: "table", caption: "Totals", headers: ["A", "B"], rows: [[1, 2]] },
  ],
};

interface SlackPostArgs {
  channel: string;
  text?: string;
  blocks?: Record<string, unknown>[];
}

/** The supervisor's `postFor`, against the real Slack vertical: it forwards the
 * seam's `presentation` to `plugin.outbound.sendText` exactly as production. */
function slackPresentationSeam(
  posts: SlackPostArgs[],
  seen: HubOutboundSendParams[],
): (params: HubOutboundSendParams) => Promise<HubOutboundSendResult> {
  const client = {
    ...slackWebClientStubForTest(),
    auth: {
      async test() {
        return { ok: true, user_id: "U_BOT" } as never;
      },
    },
    chat: {
      async postMessage(args: SlackPostArgs) {
        posts.push(args);
        return { ok: true, ts: `1788800000.00000${posts.length}`, channel: args.channel } as never;
      },
      async update() {
        return { ok: true } as never;
      },
    },
  } as WebClient;
  registerSlackWriteClientForTest(SLACK_PRESENTATION_TOKEN, client);
  const send = slackPlugin.outbound?.["sendText"] as (
    args: Record<string, unknown>,
  ) => Promise<{ messageId: string }>;
  return async (params) => {
    seen.push(params);
    const sent = await send({
      cfg: SLACK_PRESENTATION_CFG,
      accountId: "present",
      to: SLACK_CHANNEL,
      text: params.text,
      client,
      ...(params.presentation === undefined ? {} : { presentation: params.presentation }),
    });
    return { ok: true, externalMessageId: String(sent.messageId) };
  };
}

/** The same seam against the real Telegram vertical. */
function telegramPresentationSeam(
  calls: BotApiCall[],
  seen: HubOutboundSendParams[],
): (params: HubOutboundSendParams) => Promise<HubOutboundSendResult> {
  // The rich-blocks send is a raw Bot API call upstream (`send-prepared.ts`);
  // the media fake has no `raw`, so a rich account would silently fall back to
  // plain text and the table block would be invisible to this assertion.
  const api = {
    ...createFakeMediaApi(calls),
    raw: {
      async sendRichMessage(...args: unknown[]) {
        calls.push({ method: "sendRichMessage", args });
        return { message_id: calls.length, chat: { id: -100200300, type: "supergroup" } };
      },
    },
  };
  const send = telegramPlugin.outbound?.["sendText"] as unknown as (
    args: Record<string, unknown>,
  ) => Promise<{ messageId: number }>;
  return async (params) => {
    seen.push(params);
    const sent = await send({
      cfg: TELEGRAM_PRESENTATION_CFG,
      hostRuntime: MEDIA_HOST_RUNTIME,
      accountId: "present",
      to: TELEGRAM_CHAT,
      api,
      text: params.text,
      ...(params.presentation === undefined ? {} : { presentation: params.presentation }),
    });
    return { ok: true, externalMessageId: String(sent.messageId) };
  };
}

describe("presentation over the Hub outbound seam", () => {
  beforeEach(() => {
    registerChannelMessageActions(SLACK_PRESENTATION_SCOPE, slackPlugin as never);
    registerChannelMessageActions(TELEGRAM_PRESENTATION_SCOPE, telegramPlugin as never);
  });

  afterEach(() => {
    clearChannelMessageActions(SLACK_PRESENTATION_SCOPE);
    clearChannelMessageActions(TELEGRAM_PRESENTATION_SCOPE);
  });

  it("posts a Slack send's chart and table as native Block Kit blocks", async () => {
    const posts: SlackPostArgs[] = [];
    const seen: HubOutboundSendParams[] = [];
    const outcome = await runChannelMessageAction({
      ...SLACK_PRESENTATION_SCOPE,
      action: "send",
      params: { message: "W6BCHART-OK", presentation: CHART_AND_TABLE },
      conversation: { to: SLACK_CHANNEL },
      send: slackPresentationSeam(posts, seen),
    });
    assert.equal(outcome.ok, true, outcome.error);
    // The seam is handed the presentation, not a flattened body.
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.presentation?.blocks.length, 2);
    assert.equal(seen[0]?.text, "W6BCHART-OK");
    const blocks = posts.flatMap((post) => post.blocks ?? []);
    assert.ok(
      blocks.some((block) => block["type"] === "data_visualization"),
      `no data_visualization block: ${JSON.stringify(blocks.map((block) => block["type"]))}`,
    );
    assert.ok(
      blocks.some((block) => block["type"] === "data_table"),
      `no data_table block: ${JSON.stringify(blocks.map((block) => block["type"]))}`,
    );
  });

  it("posts a Telegram send's table as a native rich table block", async () => {
    const calls: BotApiCall[] = [];
    const seen: HubOutboundSendParams[] = [];
    const outcome = await runChannelMessageAction({
      ...TELEGRAM_PRESENTATION_SCOPE,
      action: "send",
      params: { message: "W6BCHART-TG", presentation: CHART_AND_TABLE },
      conversation: { to: TELEGRAM_CHAT },
      send: telegramPresentationSeam(calls, seen),
    });
    assert.equal(outcome.ok, true, outcome.error);
    // The seam is handed the presentation, not a flattened body (D-TG-057).
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.presentation?.blocks.length, 2);
    assert.equal(seen[0]?.text, "W6BCHART-TG");
    assert.deepEqual(
      calls.map((call) => call.method),
      ["sendRichMessage"],
    );
    const richMessage = (calls[0]?.args[0] as { rich_message?: { blocks?: unknown[] } })
      ?.rich_message;
    const blocks = (richMessage?.blocks ?? []) as Record<string, unknown>[];
    assert.ok(
      blocks.some((block) => block["type"] === "table"),
      `no table block: ${JSON.stringify(blocks.map((block) => block["type"]))}`,
    );
    // Telegram has no chart primitive: the chart stays readable as text.
    assert.match(JSON.stringify(blocks), /Weekly runs/u);
  });
});

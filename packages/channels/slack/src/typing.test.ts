// The Slack liveness surface: what a drive costs, and what it must never do.
// A fake write client (the web-api test seam) records every call, so the
// set-once / clear-once dedupe and the idempotent reaction outcomes are
// asserted on the actual wire args.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { registerSlackWriteClientForTest, type WebClient } from "./client/web-api.js";

/** The fake handed to the ported send path through `SlackSendOpts.client`. */
let installedFakeClient: WebClient | undefined;
import {
  clearSlackTypingScopeWarningsForTest,
  clearSlackTypingSurfacesForTest,
  slackErrorCode,
  slackTyping,
  SLACK_TYPING_LOADING_MESSAGES,
  SLACK_TYPING_STATUS,
  SLACK_TYPING_REFRESH_MS,
  type SlackTypingArgs,
} from "./typing.js";

import { sendSlackText } from "./outbound.js";

const CFG = {
  channels: { slack: { accounts: { work: { botToken: "xoxb-test-typing" } } } },
} as unknown as Record<string, unknown>;

interface Calls {
  status: Array<Record<string, unknown>>;
  add: Array<Record<string, unknown>>;
  remove: Array<Record<string, unknown>>;
}

function fakeClient(
  calls: Calls,
  failures: Partial<Record<"status" | "add" | "remove", unknown>> = {},
) {
  return {
    auth: {
      async test() {
        return { ok: true } as never;
      },
    },
    chat: {
      async postMessage(args: Record<string, unknown>) {
        // The ported send path requires a real message timestamp back.
        return { ok: true, ts: "1700.0002", channel: args["channel"] } as never;
      },
      async update() {
        return { ok: true } as never;
      },
    },
    files: {
      async getUploadURLExternal() {
        return { ok: true } as never;
      },
      async completeUploadExternal() {
        return { ok: true } as never;
      },
    },
    assistant: {
      threads: {
        async setStatus(args: Record<string, unknown>) {
          calls.status.push(args);
          if (failures.status !== undefined) throw failures.status;
          return { ok: true };
        },
      },
    },
    reactions: {
      async add(args: Record<string, unknown>) {
        calls.add.push(args);
        if (failures.add !== undefined) throw failures.add;
        return { ok: true };
      },
      async remove(args: Record<string, unknown>) {
        calls.remove.push(args);
        if (failures.remove !== undefined) throw failures.remove;
        return { ok: true };
      },
    },
  } as unknown as WebClient;
}

function install(failures?: Partial<Record<"status" | "add" | "remove", unknown>>): Calls {
  const calls: Calls = { status: [], add: [], remove: [] };
  installedFakeClient = fakeClient(calls, failures);
  registerSlackWriteClientForTest("xoxb-test-typing", installedFakeClient);
  return calls;
}

function typingArgs(overrides: Partial<SlackTypingArgs> = {}): SlackTypingArgs {
  return {
    cfg: CFG,
    accountId: "work",
    to: "C1",
    action: "start",
    indicator: true,
    threadId: "1700.0001",
    messageId: "1700.0000",
    ...overrides,
  };
}

beforeEach(() => {
  clearSlackTypingSurfacesForTest();
  clearSlackTypingScopeWarningsForTest();
});

describe("slackTyping — the thread status", () => {
  it("sets the status with the rotating loading messages, and clears it on stop", async () => {
    const calls = install();
    await slackTyping(typingArgs());
    expect(calls.status).toEqual([
      {
        channel_id: "C1",
        thread_ts: "1700.0001",
        status: SLACK_TYPING_STATUS,
        loading_messages: [...SLACK_TYPING_LOADING_MESSAGES],
      },
    ]);
    await slackTyping(typingArgs({ action: "stop" }));
    expect(calls.status[1]).toEqual({ channel_id: "C1", thread_ts: "1700.0001", status: "" });
  });

  it("sets the status once: a repeat start is a no-op", async () => {
    // Slack holds an assistant status ~2 minutes and clears it when the bot
    // answers, so re-pushing per Hub touch only spends calls.
    const calls = install();
    await slackTyping(typingArgs());
    await slackTyping(typingArgs());
    await slackTyping(typingArgs());
    expect(calls.status).toHaveLength(1);
    expect(calls.status[0]).toMatchObject({ status: SLACK_TYPING_STATUS });
  });

  it("clears once, and a second clear costs nothing", async () => {
    const calls = install();
    await slackTyping(typingArgs());
    await slackTyping(typingArgs({ action: "stop" }));
    await slackTyping(typingArgs({ action: "stop" }));
    expect(calls.status).toHaveLength(2);
    expect(calls.status[1]).toMatchObject({ status: "" });
  });

  it("does not clear a status this process never opened", async () => {
    const calls = install();
    await slackTyping(typingArgs({ action: "stop" }));
    expect(calls.status).toHaveLength(0);
  });

  it("anchors an unthreaded ask on the sender's own message ts", async () => {
    // A root message's `ts` is a valid `thread_ts`, so the status still shows
    // — under the message being answered. Only a turn with no anchor at all is
    // silent.
    const calls = install();
    await slackTyping(typingArgs({ threadId: undefined }));
    expect(calls.status[0]).toMatchObject({ thread_ts: "1700.0000" });
  });

  it("stays silent with no thread and no usable marker (a slash-command id)", async () => {
    const calls = install();
    await slackTyping(typingArgs({ threadId: undefined, messageId: "slash:1700000000:U0" }));
    expect(calls.status).toHaveLength(0);
  });

  it("throws on missing_scope so the hub breaker stops the loop", async () => {
    install({ status: { data: { error: "missing_scope", needed: "assistant:write" } } });
    await expect(slackTyping(typingArgs())).rejects.toBeDefined();
  });
});

describe("slackTyping — the receipt reaction", () => {
  it("keys the reaction on the message, not the thread", async () => {
    // Two turns answered in one thread share a status anchor; each still owes
    // its own reaction, and each close removes its own.
    const calls = install();
    const react = { indicator: false, reactionEmoji: "hourglass_flowing_sand" } as const;
    await slackTyping(typingArgs({ ...react, messageId: "1700.0001" }));
    await slackTyping(typingArgs({ ...react, messageId: "1700.0002" }));
    expect(calls.add.map((c) => c["timestamp"])).toEqual(["1700.0001", "1700.0002"]);
    await slackTyping(typingArgs({ ...react, messageId: "1700.0001", action: "stop" }));
    expect(calls.remove).toEqual([
      { channel: "C1", timestamp: "1700.0001", name: "hourglass_flowing_sand" },
    ]);
  });

  it("reacts to the sender's own message, and removes it on stop", async () => {
    const calls = install();
    await slackTyping(typingArgs({ indicator: false, reactionEmoji: "hourglass_flowing_sand" }));
    expect(calls.add).toEqual([
      { channel: "C1", timestamp: "1700.0000", name: "hourglass_flowing_sand" },
    ]);
    await slackTyping(
      typingArgs({ indicator: false, reactionEmoji: "hourglass_flowing_sand", action: "stop" }),
    );
    expect(calls.remove).toEqual([
      { channel: "C1", timestamp: "1700.0000", name: "hourglass_flowing_sand" },
    ]);
  });

  it("repeats no call while the reaction is already open", async () => {
    const calls = install();
    await slackTyping(typingArgs({ indicator: false, reactionEmoji: "eyes" }));
    await slackTyping(typingArgs({ indicator: false, reactionEmoji: "eyes" }));
    expect(calls.add).toHaveLength(1);
  });

  it("treats already_reacted / no_reaction as success (a replay, not a fault)", async () => {
    const calls = install({ add: { data: { error: "already_reacted" } } });
    await slackTyping(typingArgs({ indicator: false, reactionEmoji: "eyes" }));
    expect(calls.add).toHaveLength(1);
    install({ remove: { data: { error: "no_reaction" } } });
    await slackTyping(typingArgs({ indicator: false, reactionEmoji: "eyes", action: "stop" }));
  });

  it("does nothing when the reaction leaf is off or the marker id is absent", async () => {
    const calls = install();
    await slackTyping(typingArgs({ indicator: false }));
    await slackTyping(
      typingArgs({ indicator: false, reactionEmoji: "eyes", messageId: undefined }),
    );
    expect(calls.add).toHaveLength(0);
  });

  it("drives both surfaces in one start when the route admits both", async () => {
    const calls = install();
    await slackTyping(typingArgs({ reactionEmoji: "eyes" }));
    expect(calls.status).toHaveLength(1);
    expect(calls.add).toHaveLength(1);
  });
});

describe("slackErrorCode", () => {
  it("reads the code from the response body and from a bare error field", () => {
    expect(slackErrorCode({ data: { error: "missing_scope" } })).toBe("missing_scope");
    expect(slackErrorCode({ error: "ratelimited" })).toBe("ratelimited");
    expect(slackErrorCode("nope")).toBe("");
    expect(slackErrorCode(null)).toBe("");
  });
});

afterEach(() => {
  clearSlackTypingSurfacesForTest();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Slice 10b: `sendSlackText` now posts through the ported upstream `send.ts`,
 * which builds its write client from the ported `client.ts` cache. Upstream's
 * own injection point is `SlackSendOpts.client`, so the fake is passed per call
 * rather than registered in that cache. */
function postText(text: string) {
  return sendSlackText({
    cfg: CFG,
    accountId: "work",
    to: "C1",
    threadId: "1700.0001",
    text,
    client: installedFakeClient,
  } as never);
}

it("restores status after interim text, refreshes long turns, and leaves terminal posts clear", async () => {
  vi.useFakeTimers();
  const calls = install();
  await slackTyping(typingArgs());
  await postText("Still researching");
  expect(calls.status.map((call) => call["status"])).toEqual([
    SLACK_TYPING_STATUS,
    SLACK_TYPING_STATUS,
  ]);
  await vi.advanceTimersByTimeAsync(SLACK_TYPING_REFRESH_MS * 3);
  expect(calls.status).toHaveLength(5);
  await slackTyping(typingArgs({ action: "stop" }));
  await postText("Final answer");
  await vi.advanceTimersByTimeAsync(SLACK_TYPING_REFRESH_MS * 3);
  expect(calls.status.map((call) => call["status"])).toEqual([
    ...Array(5).fill(SLACK_TYPING_STATUS),
    "",
  ]);
});

it("queues post-send restoration behind an in-flight periodic refresh", async () => {
  vi.useFakeTimers();
  const calls: Calls = { status: [], add: [], remove: [] };
  const client = fakeClient(calls);
  const pending = deferred();
  client.assistant.threads.setStatus = async (args) => {
    calls.status.push(args);
    if (calls.status.length === 2) await pending.promise;
    return { ok: true } as never;
  };
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-typing", client);
  await slackTyping(typingArgs());
  await vi.advanceTimersByTimeAsync(SLACK_TYPING_REFRESH_MS);
  const post = postText("Interim reply clears Slack status");
  pending.resolve();
  await post;
  expect(calls.status).toHaveLength(3);
});

it("clears a delayed start before opening a replacement turn, without adding a stale reaction", async () => {
  const calls: Calls = { status: [], add: [], remove: [] };
  const client = fakeClient(calls);
  const pending = deferred();
  client.assistant.threads.setStatus = async (args) => {
    calls.status.push(args);
    if (calls.status.length === 1) await pending.promise;
    return { ok: true } as never;
  };
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-typing", client);
  const args = typingArgs({ reactionEmoji: "eyes" });
  const opening = slackTyping(args);
  await vi.waitFor(() => expect(calls.status).toHaveLength(1));
  const closing = slackTyping({ ...args, action: "stop" });
  const replacement = slackTyping(args);
  pending.resolve();
  await Promise.all([opening, closing, replacement]);
  expect(calls.status.map((call) => call["status"])).toEqual([
    SLACK_TYPING_STATUS,
    "",
    SLACK_TYPING_STATUS,
  ]);
  expect(calls.add).toHaveLength(1);
  await slackTyping({ ...args, action: "stop" });
  expect(calls.remove).toHaveLength(1);
});

it("does not clear a replacement status when an older reaction fails late", async () => {
  const calls: Calls = { status: [], add: [], remove: [] };
  const client = fakeClient(calls);
  const pending = deferred();
  client.reactions.add = async (args) => {
    calls.add.push(args);
    if (calls.add.length === 1) await pending.promise;
    return { ok: true } as never;
  };
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-typing", client);
  const args = typingArgs({ reactionEmoji: "eyes" });
  const opening = slackTyping(args);
  const rejected = expect(opening).rejects.toThrow("old reaction failed");
  await vi.waitFor(() => expect(calls.add).toHaveLength(1));
  const closing = slackTyping({ ...args, action: "stop" });
  const replacement = slackTyping(args);
  pending.reject(new Error("old reaction failed"));
  await Promise.all([rejected, closing, replacement]);
  expect(calls.status.map((call) => call["status"])).toEqual([
    SLACK_TYPING_STATUS,
    "",
    SLACK_TYPING_STATUS,
  ]);
  expect(calls.add).toHaveLength(2);
});

it("stops refreshes on provider rejection without failing an already delivered post", async () => {
  vi.useFakeTimers();
  const failures: { status?: unknown } = {};
  const calls = install(failures);
  await slackTyping(typingArgs());
  failures.status = { data: { error: "ratelimited" } };
  await expect(postText("Delivered text")).resolves.toBeDefined();
  expect(calls.status).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(SLACK_TYPING_REFRESH_MS * 3);
  expect(calls.status).toHaveLength(2);
});

it("removes a reaction whose add was still in flight when the turn stopped", async () => {
  const calls: Calls = { status: [], add: [], remove: [] };
  const client = fakeClient(calls);
  const pending = deferred();
  client.reactions.add = async (args) => {
    calls.add.push(args);
    await pending.promise;
    return { ok: true } as never;
  };
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-typing", client);
  const args = typingArgs({ indicator: false, reactionEmoji: "eyes" });
  const opening = slackTyping(args);
  await vi.waitFor(() => expect(calls.add).toHaveLength(1));
  const closing = slackTyping({ ...args, action: "stop" });
  expect(calls.remove).toHaveLength(0);
  pending.resolve();
  await Promise.all([opening, closing]);
  expect(calls.remove).toHaveLength(1);
});

// The Slack liveness surface: what a drive costs, and what it must never do.
// A fake write client (the web-api test seam) records every call, so the
// set-once / clear-once dedupe and the idempotent reaction outcomes are
// asserted on the actual wire args.

import { describe, expect, it, beforeEach } from "vitest";
import { registerSlackWriteClientForTest, type WebClient } from "./client/web-api.js";
import {
  clearSlackTypingScopeWarningsForTest,
  clearSlackTypingSurfacesForTest,
  slackErrorCode,
  slackTyping,
  SLACK_TYPING_LOADING_MESSAGES,
  SLACK_TYPING_STATUS,
  type SlackTypingArgs,
} from "./typing.js";

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
      async postMessage() {
        return { ok: true } as never;
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
  registerSlackWriteClientForTest("xoxb-test-typing", fakeClient(calls, failures));
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

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Client } from "discord.js";
import { describe, it } from "vitest";
import { createDiscordBotClient } from "./bot.js";

describe("Discord bot client", () => {
  it("classifies a disallowed-intents gateway close from its structured code", async () => {
    const canary = "gateway-login-secret-3f72";
    const client = new FakeGatewayClient(4014, new Error(canary));
    const bot = createDiscordBotClient({
      token: canary,
      clientId: "900",
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused event-compatible client double
      client: client as unknown as Client,
    });

    await assert.rejects(bot.start(), (error: unknown) => {
      if (!(error instanceof Error)) return false;
      return (
        error.name === "DiscordGatewayError" &&
        Reflect.get(error, "code") === "permissionMissing" &&
        Reflect.get(error, "gatewayCloseCode") === 4014 &&
        Reflect.get(error, "gatewayFailure") === "disallowedIntents"
      );
    });
  });

  it.each([
    [4004, "credentialsRejected"],
    [4013, "internal"],
    [4014, "permissionMissing"],
  ] as const)("maps unrecoverable gateway close %i to %s", async (closeCode, expectedCode) => {
    const client = new FakeGatewayClient(closeCode, new Error("ignored"));
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused event-compatible client double
      client: client as unknown as Client,
    });

    await assert.rejects(
      bot.start(),
      (error: unknown) => error instanceof Error && Reflect.get(error, "code") === expectedCode,
    );
  });

  it.each([4008, 4009])("does not misclassify recoverable gateway close %i", async (closeCode) => {
    const original = new Error("recoverable close");
    const client = new FakeGatewayClient(closeCode, original);
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused event-compatible client double
      client: client as unknown as Client,
    });

    // Discord.js reconnects or resumes these; presenting them as a durable setup fault would lie.
    await assert.rejects(bot.start(), (error: unknown) => error === original);
  });

  it("disables all mention parsing when sending channel messages", async () => {
    const channel = new FakeSendableChannel();
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      client: createFakeClient(channel),
    });

    await bot.sendChannelMessage({
      channelId: "200",
      threadId: null,
      content: "@everyone hello <@400>",
    });

    assert.deepEqual(channel.sentPayloads, [
      {
        content: "@everyone hello <@400>",
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("creates one thread and sends repeated conversation replies into it", async () => {
    const channel = new FakeSendableChannel({
      message: new FakeMessage("<@123456789012345678> summarize the release notes and next steps"),
    });
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      client: createFakeClient(channel),
    });

    await Promise.all([
      bot.sendConversationReply({
        channelId: "200",
        threadId: null,
        messageId: "300",
        content: "done",
      }),
      bot.sendConversationReply({
        channelId: "200",
        threadId: null,
        messageId: "300",
        content: "more detail",
      }),
    ]);
    await bot.sendConversationReply({
      channelId: "200",
      threadId: null,
      messageId: "300",
      content: "final detail",
    });

    assert.deepEqual(channel.sentPayloads, []);
    assert.deepEqual(channel.message?.startedThreads, [
      { name: "summarize the release notes and next steps" },
    ]);
    const createdThread = channel.message?.thread;
    assert.ok(createdThread);
    assert.deepEqual(createdThread.sentPayloads, [
      { content: "done", allowedMentions: { parse: [] } },
      { content: "more detail", allowedMentions: { parse: [] } },
      { content: "final detail", allowedMentions: { parse: [] } },
    ]);
  });

  it("reuses a thread already attached to the triggering channel message", async () => {
    const existingThread = new FakeSendableChannel();
    const message = new FakeMessage("question", existingThread);
    const channel = new FakeSendableChannel({ message });
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      client: createFakeClient(channel),
    });

    await bot.sendConversationReply({
      channelId: "200",
      threadId: null,
      messageId: "300",
      content: "existing thread reply",
    });

    assert.deepEqual(message.startedThreads, []);
    assert.deepEqual(existingThread.sentPayloads, [
      { content: "existing thread reply", allowedMentions: { parse: [] } },
    ]);
  });

  it("sends directly to the existing thread when replying from a thread", async () => {
    const channel = new FakeSendableChannel();
    const thread = new FakeSendableChannel();
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      client: createFakeClient(channel, thread),
    });

    await bot.sendConversationReply({
      channelId: "200",
      threadId: "207",
      messageId: "300",
      content: "thread reply",
    });
    await bot.sendConversationReply({
      channelId: "200",
      threadId: "207",
      messageId: "300",
      content: "second thread reply",
    });

    assert.deepEqual(channel.sentPayloads, []);
    assert.deepEqual(thread.sentPayloads, [
      { content: "thread reply", allowedMentions: { parse: [] } },
      { content: "second thread reply", allowedMentions: { parse: [] } },
    ]);
  });

  it("rejects invalid snowflakes before calling Discord", async () => {
    const channel = new FakeSendableChannel();
    const bot = createDiscordBotClient({
      token: "token",
      clientId: "900",
      client: createFakeClient(channel),
    });

    await assert.rejects(
      () => bot.sendChannelMessage({ channelId: "0", content: "invalid" }),
      /Invalid string/u,
    );
    await assert.rejects(
      () => bot.createReaction({ channelId: "200", messageId: "message", emoji: "eyes" }),
      /Invalid string/u,
    );
    assert.deepEqual(channel.sentPayloads, []);
  });
});

class FakeSendableChannel {
  readonly sentPayloads: unknown[] = [];
  readonly messages: { fetch: (messageId: string) => Promise<FakeMessage> };

  constructor(readonly options: { message?: FakeMessage } = {}) {
    this.messages = {
      fetch: async (messageId: string) => {
        assert.equal(messageId, "300");
        if (this.options.message === undefined) {
          throw new Error("message unavailable");
        }
        return this.options.message;
      },
    };
  }

  get message(): FakeMessage | undefined {
    return this.options.message;
  }

  async send(payload: unknown): Promise<void> {
    this.sentPayloads.push(payload);
  }
}

class FakeGatewayClient extends EventEmitter {
  constructor(
    private readonly closeCode: number,
    private readonly loginError: Error,
  ) {
    super();
  }

  async login(): Promise<never> {
    this.emit("shardDisconnect", { code: this.closeCode, reason: this.loginError.message }, 0);
    throw this.loginError;
  }

  destroy(): void {}
}

class FakeMessage {
  readonly startedThreads: unknown[] = [];

  constructor(
    readonly content: string,
    public thread: FakeSendableChannel | null = null,
  ) {}

  get hasThread(): boolean {
    return this.thread !== null;
  }

  async startThread(input: unknown): Promise<FakeSendableChannel> {
    this.startedThreads.push(input);
    this.thread = new FakeSendableChannel();
    return this.thread;
  }
}

function createFakeClient(channel: FakeSendableChannel, thread?: FakeSendableChannel): Client {
  const fakeClient = {
    on() {
      return fakeClient;
    },
    channels: {
      async fetch(channelId: string): Promise<FakeSendableChannel> {
        if (channelId === "207" && thread !== undefined) {
          return thread;
        }
        const attachedThread = channel.message?.thread;
        if (channelId === "300" && attachedThread !== undefined && attachedThread !== null)
          return attachedThread;
        assert.equal(channelId, "200");
        return channel;
      },
    },
    rest: {
      async delete(): Promise<void> {},
    },
    async login(): Promise<string> {
      return "logged-in";
    },
    destroy(): void {},
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return fakeClient as unknown as Client;
}

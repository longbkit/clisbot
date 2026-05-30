import { describe, expect, test } from "bun:test";
import { sendApiMessage } from "../src/channels/api/message-actions.ts";
import { ChannelResultStore } from "../src/channels/results/result-store.ts";
import { createLoadedConfig, tempPath } from "./support/api-channel-helpers.ts";

describe("api message actions", () => {
  test("message.send records output and renders configured provider action", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.api.chatwoot.actions = {
      "message.send": {
        method: "POST",
        url: "https://chatwoot.test/api/v1/accounts/{{reply.params.accountId}}/conversations/{{reply.targetId}}/messages",
        headers: {
          api_access_token: "{{env.CHATWOOT_API_TOKEN}}",
        },
        body: {
          content: "{{message.text}}",
          message_type: "outgoing",
          private: false,
        },
        rendering: { native: "markdown" },
        retry: { mode: "none" },
      },
    };
    process.env.CHATWOOT_API_TOKEN = "token";
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      surfaceId: "3:970",
      reply: {
        targetId: "970",
        params: { accountId: 3 },
      },
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const execution = await sendApiMessage({
      loadedConfig,
      botId: "chatwoot",
      resultStore,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response("{}", { status: 200 });
      }) as any,
      command: {
        kind: "shared",
        action: "send",
        channel: "api",
        account: "chatwoot",
        target: "dm:3:970",
        message: "Done",
        replyTo: "message-created-123",
        pollOptions: [],
        remove: false,
        forceDocument: false,
        silent: false,
        progress: false,
        final: true,
        json: false,
        inputFormat: "md",
        renderMode: "native",
      },
    });

    expect(execution.delivered).toBe(true);
    expect(calls[0]?.url).toBe("https://chatwoot.test/api/v1/accounts/3/conversations/970/messages");
    expect((calls[0]?.init.headers as any).api_access_token).toBe("token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      content: "Done",
      message_type: "outgoing",
      private: false,
    });
    const result = await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });
    expect(result?.status).toBe("completed");
    expect(result?.result?.render).toBe("markdown");
    delete process.env.CHATWOOT_API_TOKEN;
  });

  test("message.send records output without a configured provider action", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      surfaceId: "3:970",
      reply: { targetId: "970", params: { accountId: 3 } },
    });

    const execution = await sendApiMessage({
      loadedConfig,
      botId: "chatwoot",
      resultStore,
      fetch: (async () => {
        throw new Error("provider fetch should not run");
      }) as any,
      command: {
        kind: "shared",
        action: "send",
        channel: "api",
        account: "chatwoot",
        target: "dm:3:970",
        message: "Stored only",
        replyTo: "message-created-123",
        pollOptions: [],
        remove: false,
        forceDocument: false,
        silent: false,
        progress: false,
        final: true,
        json: false,
        inputFormat: "plain",
        renderMode: "none",
      },
    });

    expect(execution.delivered).toBe(false);
    expect(execution.result.status).toBe("completed");
    expect(execution.result.result?.text).toBe("Stored only");
    expect(execution.result.result?.render).toBe("text");
  });
});

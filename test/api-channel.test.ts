import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionTarget } from "../src/agents/runtime/agent-service.ts";
import type { RunUpdate } from "../src/agents/session/run-observation.ts";
import { handleApiRequest } from "../src/channels/api/service.ts";
import { sendApiMessage } from "../src/channels/api/message-actions.ts";
import { ChannelResultStore } from "../src/channels/results/result-store.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import type { LoadedConfig } from "../src/config/core/load-config.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempPath(fileName: string) {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-api-test-"));
  tempDirs.push(dir);
  return join(dir, fileName);
}

function createLoadedConfig(auth: any = { mode: "none" }): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = tempPath("sessions.json");
  config.agents.defaults.workspace = "/tmp/{agentId}";
  config.agents.defaults.runner.defaults.tmux.socketPath = "/tmp/clisbot.sock";
  config.agents.list = [{ id: "default" }];
  config.bots.api.defaults.enabled = true;
  config.bots.api.defaults.defaultBotId = "chatwoot";
  config.bots.api.chatwoot = {
    ...config.bots.api.default,
    enabled: true,
    name: "chatwoot",
    responseMode: "capture-pane",
    directMessages: {
      "3:970": {
        enabled: true,
        policy: "open",
        requireMention: false,
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    },
    ingress: {
      successStatusCode: 202,
      auth,
      filter: {
        all: [
          { path: "$.event", equals: "message_created" },
          { path: "$.message_type", equals: "incoming" },
        ],
      },
      map: {
        eventId: "message_created:{{$.id}}",
        surfaceKind: "dm",
        surfaceId: "{{$.account.id}}:{{$.conversation.id}}",
        senderId: "$.sender.id",
        senderDisplayName: "$.sender.name",
        text: "$.content",
        replyTargetId: "$.conversation.id",
        replyParams: {
          accountId: "$.account.id",
        },
      },
    },
    actions: {},
  };
  delete config.bots.api.default;
  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp",
    raw: {
      ...config,
      session: {
        ...config.app.session,
        dmScope: config.bots.defaults.dmScope,
      },
      control: config.app.control,
      tmux: config.agents.defaults.runner.defaults.tmux,
    },
  };
}

function createAgentService(overrides: Record<string, unknown> = {}) {
  return {
    isAwaitingFollowUpRouting: async () => false,
    canSteerActiveRun: () => false,
    interruptSession: async () => ({
      interrupted: false,
      agentId: "default",
      sessionName: "api-test",
    }),
    getSessionDiagnostics: async () => ({}),
    getMaxMessageChars: () => 12000,
    recordConversationReply: async () => undefined,
    getSessionRuntime: async () => ({ state: "idle" }),
    enqueuePrompt: (target: AgentSessionTarget, _prompt: string | (() => string), callbacks: any) => {
      const update: RunUpdate = {
        status: "completed",
        agentId: target.agentId,
        sessionKey: target.sessionKey,
        sessionName: "api-test",
        workspacePath: "/tmp/default",
        snapshot: "Agent final answer",
        fullSnapshot: "Agent final answer",
        initialSnapshot: "",
      };
      void callbacks.onPromptRunStarted?.({ startedAt: Date.now() });
      return {
        positionAhead: 0,
        persisted: Promise.resolve(),
        result: Promise.resolve(update),
      };
    },
    resolveEffectiveTimezone: () => ({ timezone: "UTC" }),
    ...overrides,
  } as any;
}

function chatwootPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    event: "message_created",
    message_type: "incoming",
    account: { id: 3 },
    conversation: { id: 970 },
    sender: { id: "u123", name: "A User" },
    content: "Please help",
    ...overrides,
  };
}

describe("api channel", () => {
  test("rejects bad hmac before creating a result record", async () => {
    process.env.API_TEST_SECRET = "secret";
    const loadedConfig = createLoadedConfig({
      mode: "hmac",
      secretEnv: "API_TEST_SECRET",
      timestampHeader: "x-ts",
      signatureHeader: "x-sig",
      signaturePrefix: "sha256=",
      signingBase: "{{timestamp}}.{{rawBody}}",
      toleranceSecondsDefault: 300,
    });
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    const rawBody = "{bad json";
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        headers: {
          "x-ts": String(Math.floor(Date.now() / 1000)),
          "x-sig": "sha256=bad",
        },
        body: rawBody,
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore,
    });

    expect(response.status).toBe(401);
    expect(await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    })).toBeNull();
    delete process.env.API_TEST_SECRET;
  });

  test("accepts a mapped event, processes it, and exposes the result", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        body: JSON.stringify(chatwootPayload()),
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore,
    });
    const accepted = await response.json() as any;

    expect(response.status).toBe(202);
    expect(accepted).toMatchObject({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      status: "queued",
      resultUrl: "/api/bots/chatwoot/events/message_created%3A123/result",
    });

    let result: any;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Bun.sleep(20);
      const resultResponse = await handleApiRequest({
        request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message_created%3A123/result"),
        remoteAddress: "127.0.0.1",
        loadedConfig,
        agentService: createAgentService(),
        resultStore,
      });
      result = await resultResponse.json() as any;
      if (result.status === "completed") {
        break;
      }
    }
    expect(result.status).toBe("completed");
    expect(result.result.text).toContain("Agent final answer");
    expect(result.reply.params.accountId).toBe(3);
  });

  test("records filtered events without dispatching them", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        body: JSON.stringify(chatwootPayload({ message_type: "outgoing" })),
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore,
    });
    const accepted = await response.json() as any;
    const result = await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    });

    expect(accepted.status).toBe("filtered");
    expect(result?.status).toBe("filtered");
  });

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
      eventId: "message_created:123",
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
        replyTo: "message_created:123",
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
      eventId: "message_created:123",
    });
    expect(result?.status).toBe("completed");
    expect(result?.result?.render).toBe("markdown");
    delete process.env.CHATWOOT_API_TOKEN;
  });

  test("hmac accepts a valid signature", async () => {
    process.env.API_TEST_SECRET = "secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(chatwootPayload({ id: 456 }));
    const signature = `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${rawBody}`).digest("hex")}`;
    const loadedConfig = createLoadedConfig({
      mode: "hmac",
      secretEnv: "API_TEST_SECRET",
      timestampHeader: "x-ts",
      signatureHeader: "x-sig",
      signaturePrefix: "sha256=",
      signingBase: "{{timestamp}}.{{rawBody}}",
      toleranceSecondsDefault: 300,
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        headers: {
          "x-ts": timestamp,
          "x-sig": signature,
        },
        body: rawBody,
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore: new ChannelResultStore(tempPath("results.json")),
    });

    expect(response.status).toBe(202);
    expect((await response.json() as any).eventId).toBe("message_created:456");
    delete process.env.API_TEST_SECRET;
  });

  test("bearer auth accepts the configured token", async () => {
    process.env.API_TEST_TOKEN = "token-123";
    const loadedConfig = createLoadedConfig({
      mode: "bearer",
      tokenEnv: "API_TEST_TOKEN",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        headers: {
          authorization: "Bearer token-123",
        },
        body: JSON.stringify(chatwootPayload({ id: 789 })),
      }),
      remoteAddress: "10.0.0.5",
      loadedConfig,
      agentService: createAgentService(),
      resultStore: new ChannelResultStore(tempPath("results.json")),
    });

    expect(response.status).toBe(202);
    expect((await response.json() as any).eventId).toBe("message_created:789");
    delete process.env.API_TEST_TOKEN;
  });

  test("none auth is loopback-only", async () => {
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        body: JSON.stringify(chatwootPayload()),
      }),
      remoteAddress: "10.0.0.5",
      loadedConfig: createLoadedConfig(),
      agentService: createAgentService(),
      resultStore: new ChannelResultStore(tempPath("results.json")),
    });

    expect(response.status).toBe(401);
  });

  test("stops an active event run by event id", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      status: "processing",
      surfaceId: "3:970",
      surfaceKind: "dm",
      agentId: "default",
      sessionKey: "agent:default:api:chatwoot:dm:3:970",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message_created%3A123/stop", {
        method: "POST",
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService({
        interruptSession: async () => ({
          interrupted: true,
          agentId: "default",
          sessionName: "api-test",
        }),
      }),
      resultStore,
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      eventId: "message_created:123",
      status: "stopped",
      stopped: true,
    });
    expect((await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    }))?.status).toBe("stopped");
  });

  test("rejects stop for a finished event", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      status: "completed",
      surfaceId: "3:970",
      surfaceKind: "dm",
      agentId: "default",
      sessionKey: "agent:default:api:chatwoot:dm:3:970",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message_created%3A123/stop", {
        method: "POST",
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore,
    });
    const body = await response.json() as any;

    expect(response.status).toBe(409);
    expect(body.error).toBe("event_not_running");
    expect(body.status).toBe("completed");
  });

  test("stops the active run for a surface without knowing event id", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      status: "processing",
      surfaceId: "3:970",
      surfaceKind: "dm",
      agentId: "default",
      sessionKey: "agent:default:api:chatwoot:dm:3:970",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/surfaces/3%3A970/stop", {
        method: "POST",
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService({
        interruptSession: async () => ({
          interrupted: true,
          agentId: "default",
          sessionName: "api-test",
        }),
      }),
      resultStore,
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      surfaceId: "3:970",
      eventId: "message_created:123",
      status: "stopped",
      stopped: true,
    });
  });
});

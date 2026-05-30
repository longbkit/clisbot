import { describe, expect, test } from "bun:test";
import { ApiChannelService, handleApiRequest } from "../src/channels/api/service.ts";
import { ChannelResultStore } from "../src/channels/results/result-store.ts";
import { chatwootPayload, createAgentService, createLoadedConfig, hmacHeaders, tempPath } from "./support/api-channel-helpers.ts";

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
      eventId: "message-created-123",
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
      eventId: "message-created-123",
      status: "queued",
      resultUrl: "/api/bots/chatwoot/events/message-created-123/result",
    });

    let result: any;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Bun.sleep(20);
      const resultResponse = await handleApiRequest({
        request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message-created-123/result"),
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
      eventId: "message-created-123",
    });

    expect(accepted.status).toBe("filtered");
    expect(result?.status).toBe("filtered");
  });

  test("hmac accepts a valid signature", async () => {
    process.env.API_TEST_SECRET = "secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(chatwootPayload({ id: 456 }));
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
        headers: hmacHeaders({ body: rawBody, secret: "secret", timestamp }),
        body: rawBody,
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService(),
      resultStore: new ChannelResultStore(tempPath("results.json")),
    });

    expect(response.status).toBe(202);
    expect((await response.json() as any).eventId).toBe("message-created-456");
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
    expect((await response.json() as any).eventId).toBe("message-created-789");
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

  test("deduplicates events per bot without blocking the same event id on another bot", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.api.jira = JSON.parse(JSON.stringify(loadedConfig.raw.bots.api.chatwoot));
    loadedConfig.raw.bots.api.jira.name = "jira";
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    const agentService = createAgentService();
    const chatwootRequest = () => new Request("http://127.0.0.1/api/bots/chatwoot/events", {
      method: "POST",
      body: JSON.stringify(chatwootPayload()),
    });
    const jiraRequest = () => new Request("http://127.0.0.1/api/bots/jira/events", {
      method: "POST",
      body: JSON.stringify(chatwootPayload()),
    });

    const first = await handleApiRequest({
      request: chatwootRequest(),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService,
      resultStore,
    });
    const duplicate = await handleApiRequest({
      request: chatwootRequest(),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService,
      resultStore,
    });
    const otherBot = await handleApiRequest({
      request: jiraRequest(),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService,
      resultStore,
    });

    expect((await first.json() as any).status).toBe("queued");
    expect((await duplicate.json() as any).status).toBe("duplicate");
    expect((await otherBot.json() as any).status).toBe("queued");
    expect(await resultStore.getResult({
      channel: "api",
      botId: "jira",
      eventId: "message-created-123",
    })).not.toBeNull();
  });

  test("steers active runs when runMode maps to steer", async () => {
    const loadedConfig = createLoadedConfig();
    (loadedConfig.raw.bots.api.chatwoot.ingress as any).map.runMode = "steer";
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    let submitted = false;

    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events", {
        method: "POST",
        body: JSON.stringify(chatwootPayload()),
      }),
      remoteAddress: "127.0.0.1",
      loadedConfig,
      agentService: createAgentService({
        isAwaitingFollowUpRouting: async () => true,
        canSteerActiveRun: () => true,
        submitSessionInput: async () => {
          submitted = true;
        },
      }),
      resultStore,
    });
    const accepted = await response.json() as any;

    for (let attempt = 0; attempt < 10 && !submitted; attempt += 1) {
      await Bun.sleep(10);
    }
    const result = await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });
    expect(accepted.status).toBe("steered");
    expect(submitted).toBe(true);
    expect(result?.status).toBe("steered");
  });

  test("records failed status when route admission fails", async () => {
    const loadedConfig = createLoadedConfig();
    delete loadedConfig.raw.bots.api.chatwoot.directMessages["3:970"];
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
    const result = await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });

    expect(accepted.status).toBe("failed");
    expect(result?.status).toBe("failed");
    expect(result?.error?.code).toBe("route_not_admitted");
  });

  test("stops an active event run by event id", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      status: "processing",
      surfaceId: "3:970",
      surfaceKind: "dm",
      agentId: "default",
      sessionKey: "agent:default:api:chatwoot:dm:3:970",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message-created-123/stop", {
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
      eventId: "message-created-123",
      status: "stopped",
      stopped: true,
    });
    expect((await resultStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    }))?.status).toBe("stopped");
  });

  test("rejects stop for a finished event", async () => {
    const loadedConfig = createLoadedConfig();
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    await resultStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      status: "completed",
      surfaceId: "3:970",
      surfaceKind: "dm",
      agentId: "default",
      sessionKey: "agent:default:api:chatwoot:dm:3:970",
    });
    const response = await handleApiRequest({
      request: new Request("http://127.0.0.1/api/bots/chatwoot/events/message-created-123/stop", {
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
      eventId: "message-created-123",
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
      eventId: "message-created-123",
      status: "stopped",
      stopped: true,
    });
  });

  test("serves event ingress and result polling through the real listener", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.api.defaults.listener = { host: "127.0.0.1", port: 0 };
    const resultStore = new ChannelResultStore(tempPath("results.json"));
    const service = new ApiChannelService({
      loadedConfig,
      agentService: createAgentService(),
      resultStore,
    });
    await service.start();
    const port = (service as any).server.port;

    try {
      const acceptedResponse = await fetch(`http://127.0.0.1:${port}/api/bots/chatwoot/events`, {
        method: "POST",
        body: JSON.stringify(chatwootPayload({ id: 555 })),
      });
      const accepted = await acceptedResponse.json() as any;
      expect(acceptedResponse.status).toBe(202);
      expect(accepted.eventId).toBe("message-created-555");

      let result: any;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await Bun.sleep(20);
        const resultResponse = await fetch(`http://127.0.0.1:${port}/api/bots/chatwoot/events/message-created-555/result`);
        result = await resultResponse.json();
        if (result.status === "completed") {
          break;
        }
      }
      expect(result.status).toBe("completed");
      expect(result.result.text).toContain("Agent final answer");
    } finally {
      await service.stop();
    }
  });
});

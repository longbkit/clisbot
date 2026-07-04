import { afterEach, describe, expect, test } from "bun:test";
import { handleApiRequest } from "../src/channels/api/service.ts";
import { ChannelResultStore } from "../src/channels/results/result-store.ts";
import type { AgentService } from "../src/agents/runtime/agent-service.ts";
import type { SessionFeedEntry } from "../src/agents/session/run-event-feed.ts";
import { createAgentService, createLoadedConfig, tempPath } from "./support/api-channel-helpers.ts";

const TOKEN_ENV = "CLISBOT_TEST_WEB_VIEW_TOKEN";

afterEach(() => {
  delete process.env[TOKEN_ENV];
});

function feedEntry(seq: number, snapshot: string): SessionFeedEntry {
  return {
    seq,
    at: 1_000 + seq,
    sessionKey: "agent:default:api:dm:3:970",
    agentId: "default",
    payload: { kind: "run-update", status: "running", snapshot },
  };
}

function createWebViewParams(agentOverrides: Record<string, unknown> = {}) {
  process.env[TOKEN_ENV] = "web-view-secret";
  return {
    loadedConfig: createLoadedConfig({ mode: "bearer", tokenEnv: TOKEN_ENV }),
    resultStore: new ChannelResultStore(tempPath("results.json")),
    agentService: createAgentService({
      listSessionEntries: async () => [
        {
          sessionKey: "agent:default:api:dm:3:970",
          agentId: "default",
          updatedAt: 2_000,
          sessionId: "11111111-1111-1111-1111-111111111111",
          runtime: { state: "running" },
        },
        {
          sessionKey: "agent:default:slack:dm:U1",
          agentId: "default",
          updatedAt: 1_000,
          runtime: { state: "idle" },
        },
      ],
      readSessionEvents: () => [feedEntry(1, "first"), feedEntry(2, "second")],
      subscribeSessionEvents: () => () => undefined,
      ...agentOverrides,
    }) as unknown as AgentService,
  };
}

describe("api web view endpoints", () => {
  test("lists sessions newest-first with a valid bearer token", async () => {
    const params = createWebViewParams();

    const response = await handleApiRequest({
      ...params,
      request: new Request("http://localhost/api/bots/chatwoot/sessions", {
        headers: { authorization: "Bearer web-view-secret" },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{ sessionKey: string; runtimeState: string; resumable: boolean }>;
    };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].sessionKey).toBe("agent:default:api:dm:3:970");
    expect(body.sessions[0].runtimeState).toBe("running");
    expect(body.sessions[0].resumable).toBe(true);
    expect(body.sessions[1].resumable).toBe(false);
  });

  test("rejects a missing or wrong token and accepts ?token= for browsers", async () => {
    const params = createWebViewParams();

    const denied = await handleApiRequest({
      ...params,
      request: new Request("http://localhost/api/bots/chatwoot/sessions"),
    });
    expect(denied.status).toBe(401);

    const wrongToken = await handleApiRequest({
      ...params,
      request: new Request("http://localhost/api/bots/chatwoot/sessions?token=nope"),
    });
    expect(wrongToken.status).toBe(401);

    const queryToken = await handleApiRequest({
      ...params,
      request: new Request(
        "http://localhost/api/bots/chatwoot/sessions?token=web-view-secret",
      ),
    });
    expect(queryToken.status).toBe(200);
  });

  test("streams replayed feed entries over SSE and unsubscribes on cancel", async () => {
    let unsubscribed = false;
    let liveListener: ((entry: SessionFeedEntry) => void) | undefined;
    const params = createWebViewParams({
      subscribeSessionEvents: (_sessionKey: string, listener: (entry: SessionFeedEntry) => void) => {
        liveListener = listener;
        return () => {
          unsubscribed = true;
        };
      },
    });

    const response = await handleApiRequest({
      ...params,
      request: new Request(
        "http://localhost/api/bots/chatwoot/sessions/agent%3Adefault%3Aapi%3Adm%3A3%3A970/events?token=web-view-secret",
      ),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes('"snapshot":"second"')) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      received += decoder.decode(value);
    }
    expect(received).toContain("id: 1");
    expect(received).toContain('"snapshot":"first"');
    expect(received).toContain('"snapshot":"second"');

    liveListener?.(feedEntry(3, "live"));
    while (!received.includes('"snapshot":"live"')) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      received += decoder.decode(value);
    }
    expect(received).toContain("id: 3");

    await reader.cancel();
    expect(unsubscribed).toBe(true);
  });

  test("serves the read-only demo page without auth", async () => {
    const params = createWebViewParams();

    const response = await handleApiRequest({
      ...params,
      request: new Request("http://localhost/api/bots/chatwoot/demo"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("clisbot");
    expect(html).toContain("EventSource");
    expect(html).not.toContain("web-view-secret");
  });
});

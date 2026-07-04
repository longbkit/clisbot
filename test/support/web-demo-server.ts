// Boots the API web view + demo page against a scripted SessionEventFeed so
// e2e tests and evidence capture can exercise the real endpoints and the real
// demo page without a full runtime. The scripted feed mirrors a real
// Slack-origin ACP run: prompt, streaming deltas, plan, tool calls, a
// permission request, usage, and a live completion shortly after boot.

import { startApiHttpListener, type ApiHttpListener } from "../../src/channels/api/http-listener.ts";
import { handleApiRequest } from "../../src/channels/api/service.ts";
import { ChannelResultStore } from "../../src/channels/results/result-store.ts";
import { SessionEventFeed } from "../../src/agents/session/run-event-feed.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import type { AgentService } from "../../src/agents/runtime/agent-service.ts";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";

export const WEB_DEMO_TOKEN = "demo-token";
export const WEB_DEMO_BOT_ID = "demo";

export const WEB_DEMO_FOLLOWED_SESSION = {
  sessionKey: "agent:default:slack:group:C042:thread:1719",
  agentId: "default",
};

const TELEGRAM_SESSION = {
  sessionKey: "agent:codex-acp:telegram:topic:-1002:411",
  agentId: "codex-acp",
};

export const WEB_DEMO_FINAL_REPLY =
  "Fixed. The discount now rounds once per order (banker's rounding), matching the invoice totals.";

function seedFollowedSessionHistory(feed: SessionEventFeed) {
  feed.publishUpdate(WEB_DEMO_FOLLOWED_SESSION, {
    status: "running",
    snapshot: "› Review the failing checkout test and fix the root cause",
  });
  feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, {
    type: "plan",
    entries: [
      { title: "Reproduce the failing test", status: "completed" },
      { title: "Fix the discount rounding bug", status: "in-progress" },
      { title: "Run the checkout suite", status: "pending" },
    ],
  });
  feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, {
    type: "tool-call",
    callId: "call-1",
    title: "Read tests/checkout.spec.ts",
    status: "completed",
  });
  feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, {
    type: "permission-request",
    requestId: "call-2",
    title: "Edit src/pricing/discount.ts",
    options: [
      { optionId: "allow-once", label: "Allow once", kind: "allow-once" },
      { optionId: "reject-once", label: "Reject", kind: "reject-once" },
    ],
  });
  feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, {
    type: "tool-call",
    callId: "call-2",
    title: "Edit src/pricing/discount.ts",
    status: "completed",
  });
  // Running snapshots accumulate like the real monitors produce them: the
  // turn transcript grows in place, so the demo's live card replacement shows
  // the full current-turn view at every step.
  feed.publishUpdate(WEB_DEMO_FOLLOWED_SESSION, {
    status: "running",
    snapshot:
      "› Review the failing checkout test and fix the root cause\n\nFound it: the discount is rounded per line item instead of per order, so totals drift by 1-2 cents on mixed carts.\n\n⏺ Read tests/checkout.spec.ts [✓]\n\n⏺ Edit src/pricing/discount.ts [✓]",
  });
  feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, { type: "usage", totalTokens: 18_240 });
  feed.publishUpdate(WEB_DEMO_FOLLOWED_SESSION, {
    status: "running",
    snapshot:
      "› Review the failing checkout test and fix the root cause\n\nFound it: the discount is rounded per line item instead of per order, so totals drift by 1-2 cents on mixed carts.\n\n⏺ Read tests/checkout.spec.ts [✓]\n\n⏺ Edit src/pricing/discount.ts [✓]\n\n⏺ Run bun test tests/checkout.spec.ts […]",
  });
}

export type WebDemoServer = {
  listener: ApiHttpListener;
  feed: SessionEventFeed;
  demoUrl: string;
  /** Publishes the closing tool result + final completed reply. */
  publishCompletion: () => void;
  stop: () => Promise<void>;
};

export async function startWebDemoServer(params: { port?: number } = {}): Promise<WebDemoServer> {
  process.env.WEB_DEMO_TOKEN = WEB_DEMO_TOKEN;
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.api.defaults.enabled = true;
  const defaultApiBot = (config.bots.api as Record<string, unknown>).default as Record<
    string,
    unknown
  >;
  (config.bots.api as Record<string, unknown>)[WEB_DEMO_BOT_ID] = {
    ...defaultApiBot,
    enabled: true,
    name: WEB_DEMO_BOT_ID,
    ingress: {
      ...(defaultApiBot.ingress as Record<string, unknown>),
      auth: { mode: "bearer", tokenEnv: "WEB_DEMO_TOKEN" },
    },
  };

  const feed = new SessionEventFeed();
  seedFollowedSessionHistory(feed);

  const agentService = {
    listSessionEntries: async () => [
      {
        sessionKey: WEB_DEMO_FOLLOWED_SESSION.sessionKey,
        agentId: WEB_DEMO_FOLLOWED_SESSION.agentId,
        updatedAt: Date.now(),
        runtime: { state: "running" },
        sessionId: "019f2c07-ce6e-7711-b412-5e5f74da60f1",
      },
      {
        sessionKey: TELEGRAM_SESSION.sessionKey,
        agentId: TELEGRAM_SESSION.agentId,
        updatedAt: Date.now() - 8 * 60_000,
        runtime: { state: "detached" },
        sessionId: "019f2173-9ef9-7f91-a7e1-1c5cb6e878f3",
      },
      {
        sessionKey: "agent:default:api:dm:3:970",
        agentId: "default",
        updatedAt: Date.now() - 55 * 60_000,
        runtime: { state: "idle" },
      },
    ],
    readSessionEvents: (sessionKey: string, sinceSeq = 0) => feed.read(sessionKey, sinceSeq),
    subscribeSessionEvents: (
      sessionKey: string,
      listener: Parameters<SessionEventFeed["subscribe"]>[1],
    ) => feed.subscribe(sessionKey, listener),
  } as unknown as AgentService;

  const listener = await startApiHttpListener({
    host: "127.0.0.1",
    port: params.port ?? 0,
    handle: (request, remoteAddress) =>
      handleApiRequest({
        request,
        remoteAddress,
        loadedConfig: { raw: config, stateDir: "/tmp" } as unknown as LoadedConfig,
        agentService,
        resultStore: new ChannelResultStore("/tmp/clisbot-web-demo-results.json"),
      }),
  });

  return {
    listener,
    feed,
    demoUrl:
      `http://127.0.0.1:${listener.port}/api/bots/${WEB_DEMO_BOT_ID}/demo` +
      `?token=${WEB_DEMO_TOKEN}&follow=first`,
    publishCompletion: () => {
      feed.publishRunEvent(WEB_DEMO_FOLLOWED_SESSION, {
        type: "tool-call",
        callId: "call-3",
        title: "Run bun test tests/checkout.spec.ts",
        status: "completed",
      });
      feed.publishUpdate(WEB_DEMO_FOLLOWED_SESSION, {
        status: "completed",
        snapshot:
          `› Review the failing checkout test and fix the root cause\n\n${WEB_DEMO_FINAL_REPLY}\n\n⏺ Read tests/checkout.spec.ts [✓]\n⏺ Edit src/pricing/discount.ts [✓]\n⏺ Run bun test tests/checkout.spec.ts [✓]\n\nAll 34 checkout tests pass. The fix is in src/pricing/discount.ts; want me to open a PR?`,
      });
    },
    stop: async () => {
      await listener.stop(true);
    },
  };
}

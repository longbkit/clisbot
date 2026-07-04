// Read-only web view endpoints on the API channel: session listing and a
// live SSE stream of the SessionEventFeed, plus the tiny built-in demo page.
// These are the W-1/W-2 slices of the web chat channel architecture doc; the
// full React surface builds on the same endpoints.

import type { AgentService } from "../../agents/runtime/agent-service.ts";
import type { SessionFeedEntry } from "../../agents/session/run-event-feed.ts";
import { authorizeApiBotRequest } from "./auth.ts";
import type { ApiAuthConfig } from "./config.ts";
import { jsonResponse } from "./http-contract.ts";

const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

// EventSource cannot set an Authorization header, so the SSE and listing
// endpoints also accept ?token=<bearer token>. Query tokens can end up in
// server logs; treat them as a browser-only convenience, not the primary
// auth path.
function authorizeReadRequest(params: {
  auth: ApiAuthConfig;
  request: Request;
  remoteAddress?: string | null;
}) {
  const direct = authorizeApiBotRequest(params.auth, {
    headers: params.request.headers,
    rawBody: "",
    remoteAddress: params.remoteAddress,
  });
  if (direct) {
    return true;
  }
  const token = new URL(params.request.url).searchParams.get("token")?.trim();
  if (!token) {
    return false;
  }
  const headers = new Headers(params.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return authorizeApiBotRequest(params.auth, {
    headers,
    rawBody: "",
    remoteAddress: params.remoteAddress,
  });
}

export async function handleSessionsListRequest(params: {
  request: Request;
  remoteAddress?: string | null;
  agentService: AgentService;
  auth: ApiAuthConfig;
}) {
  if (params.request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!authorizeReadRequest(params)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const entries = await params.agentService.listSessionEntries();
  const sessions = entries
    .map((entry) => ({
      sessionKey: entry.sessionKey,
      agentId: entry.agentId,
      updatedAt: entry.updatedAt,
      runtimeState: entry.runtime?.state ?? "idle",
      resumable: Boolean(entry.sessionId),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return jsonResponse({ sessions }, { status: 200 });
}

function renderSseEntry(entry: SessionFeedEntry) {
  return `id: ${entry.seq}\nevent: session\ndata: ${JSON.stringify(entry)}\n\n`;
}

export async function handleSessionEventsRequest(params: {
  request: Request;
  remoteAddress?: string | null;
  agentService: AgentService;
  auth: ApiAuthConfig;
  sessionKey: string;
}) {
  if (params.request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!authorizeReadRequest(params)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(params.request.url);
  const lastEventIdHeader = params.request.headers.get("last-event-id");
  const sinceSeq = Number(url.searchParams.get("since") ?? lastEventIdHeader ?? "0") || 0;
  const encoder = new TextEncoder();
  const { agentService, sessionKey } = params;

  let keepalive: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Consumer already went away; teardown happens in cancel().
        }
      };
      push(`retry: 3000\n\n`);
      for (const entry of agentService.readSessionEvents(sessionKey, sinceSeq)) {
        push(renderSseEntry(entry));
      }
      unsubscribe = agentService.subscribeSessionEvents(sessionKey, (entry) => {
        push(renderSseEntry(entry));
      });
      keepalive = setInterval(() => {
        push(`: keepalive ${Date.now()}\n\n`);
      }, SSE_KEEPALIVE_INTERVAL_MS);
    },
    cancel() {
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

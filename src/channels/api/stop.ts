import type { AgentService } from "../../agents/runtime/agent-service.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { ChannelResultStore } from "../results/result-store.ts";
import { authorizeApiBotRequest } from "./auth.ts";
import { resolveApiBotConfig } from "./config.ts";
import { buildAcceptanceBody, isTerminalResultStatus, jsonResponse } from "./http-contract.ts";

type ApiStopParams = {
  request: Request;
  remoteAddress?: string | null;
  loadedConfig: LoadedConfig;
  agentService: AgentService;
  resultStore: ChannelResultStore;
  botId: string;
  botConfig: ReturnType<typeof resolveApiBotConfig>;
};

async function authorizeStopRequest(params: Pick<ApiStopParams, "request" | "remoteAddress" | "botConfig">) {
  const rawBody = await params.request.text();
  return authorizeApiBotRequest(params.botConfig.ingress.auth, {
    headers: params.request.headers,
    rawBody,
    remoteAddress: params.remoteAddress,
  });
}

export async function handleEventStopRequest(params: ApiStopParams & { eventId: string }) {
  if (params.request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!(await authorizeStopRequest(params))) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }
  const record = await params.resultStore.getResult({
    channel: "api",
    botId: params.botId,
    eventId: params.eventId,
  });
  if (!record) {
    return jsonResponse({ error: "not_found" }, { status: 404 });
  }
  if (isTerminalResultStatus(record.status)) {
    return jsonResponse({ error: "event_not_running", status: record.status }, { status: 409 });
  }
  if (!record.agentId || !record.sessionKey) {
    return jsonResponse({ error: "event_has_no_active_session" }, { status: 409 });
  }
  const stopped = await params.agentService.interruptSession({
    agentId: record.agentId,
    sessionKey: record.sessionKey,
  });
  if (!stopped.interrupted) {
    return jsonResponse({ error: "event_not_running", status: record.status }, { status: 409 });
  }
  const updated = await params.resultStore.updateStatus({
    channel: "api",
    botId: params.botId,
    eventId: params.eventId,
    status: "stopped",
    error: {
      code: "event_stopped",
      message: "API event run was stopped.",
      category: "control",
    },
  }) ?? record;
  return jsonResponse({
    ...buildAcceptanceBody(updated),
    stopped: true,
  }, { status: 200 });
}

export async function handleSurfaceStopRequest(params: ApiStopParams & { surfaceId: string }) {
  if (params.request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!(await authorizeStopRequest(params))) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }
  const surface = await params.resultStore.resolveSurfaceReply({
    channel: "api",
    botId: params.botId,
    surfaceId: params.surfaceId,
  });
  if (!surface) {
    return jsonResponse({ error: "not_found" }, { status: 404 });
  }
  if (!surface.agentId || !surface.sessionKey) {
    return jsonResponse({ error: "surface_has_no_active_session" }, { status: 409 });
  }
  const stopped = await params.agentService.interruptSession({
    agentId: surface.agentId,
    sessionKey: surface.sessionKey,
  });
  if (!stopped.interrupted) {
    return jsonResponse({ error: "surface_not_running" }, { status: 409 });
  }
  await updateActiveSurfaceEvent(params, surface.activeEventId);
  return jsonResponse({
    channel: "api",
    botId: params.botId,
    surfaceId: params.surfaceId,
    eventId: surface.activeEventId,
    status: "stopped",
    stopped: true,
  }, { status: 200 });
}

async function updateActiveSurfaceEvent(params: ApiStopParams, eventId?: string) {
  if (!eventId) {
    return;
  }
  const record = await params.resultStore.getResult({
    channel: "api",
    botId: params.botId,
    eventId,
  });
  if (record && !isTerminalResultStatus(record.status)) {
    await params.resultStore.updateStatus({
      channel: "api",
      botId: params.botId,
      eventId,
      status: "stopped",
      error: {
        code: "event_stopped",
        message: "API surface run was stopped.",
        category: "control",
      },
    });
  }
}

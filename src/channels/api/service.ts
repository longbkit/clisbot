import type { AgentService } from "../../agents/runtime/agent-service.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import { isChannelSenderAllowed, isChannelSenderBlocked } from "../pairing/access.ts";
import { buildAgentPromptText } from "../message/agent-prompt.ts";
import { processChannelInteraction } from "../message/interaction-processing.ts";
import { buildSurfacePromptContext } from "../surface/surface-prompt-context.ts";
import { ChannelResultStore, type ChannelResultRecord } from "../results/result-store.ts";
import { authorizeApiBotRequest } from "./auth.ts";
import { listApiBotIds, resolveApiBotConfig, resolveApiProviderConfig } from "./config.ts";
import { buildAcceptanceBody, jsonResponse, parseApiPath } from "./http-contract.ts";
import { evaluateApiFilter, evaluateApiMapObject, normalizeMappedString } from "./mapper.ts";
import { resolveApiConversationRoute } from "./route-config.ts";
import { resolveApiConversationTarget } from "./session-routing.ts";
import { handleEventStopRequest, handleSurfaceStopRequest } from "./stop.ts";

export type ApiServiceDependencies = {
  loadedConfig: LoadedConfig;
  agentService: AgentService;
  resultStore?: ChannelResultStore;
};

type ApiMappedEvent = {
  eventId: string;
  surfaceKind: "dm" | "group";
  surfaceId: string;
  senderId: string;
  senderDisplayName?: string;
  text: string;
  runMode?: "queue" | "steer";
  replyTargetId?: string;
  replyParams?: Record<string, unknown>;
};

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "api_event_failed",
    message,
    category: "processing",
  };
}

function normalizeMappedEvent(mapped: Record<string, unknown>): ApiMappedEvent {
  const surfaceKind = normalizeMappedString(mapped.surfaceKind, "surfaceKind");
  if (surfaceKind !== "dm" && surfaceKind !== "group") {
    throw new Error("Mapped surfaceKind must be dm or group");
  }
  const rawRunMode = mapped.runMode == null || mapped.runMode === ""
    ? undefined
    : normalizeMappedString(mapped.runMode, "runMode");
  if (rawRunMode && rawRunMode !== "queue" && rawRunMode !== "steer") {
    throw new Error("Mapped runMode must be queue or steer");
  }
  const runMode = rawRunMode as "queue" | "steer" | undefined;
  return {
    eventId: normalizeMappedString(mapped.eventId, "eventId"),
    surfaceKind,
    surfaceId: normalizeMappedString(mapped.surfaceId, "surfaceId"),
    senderId: normalizeMappedString(mapped.senderId, "senderId"),
    senderDisplayName: mapped.senderDisplayName == null ? undefined : String(mapped.senderDisplayName),
    text: normalizeMappedString(mapped.text, "text"),
    runMode,
    replyTargetId: mapped.replyTargetId == null ? undefined : String(mapped.replyTargetId),
    replyParams: typeof mapped.replyParams === "object" && mapped.replyParams !== null && !Array.isArray(mapped.replyParams)
      ? mapped.replyParams as Record<string, unknown>
      : undefined,
  };
}

function appendApiReplyToPrompt(prompt: string, eventId: string) {
  return prompt.replace(
    "</system>",
    `For this API event, include \`--reply-to ${eventId}\` on every \`clisbot message send --channel api\` progress or final command so the result store updates the correct event.\n</system>`,
  );
}

export class ApiChannelService {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly resultStore: ChannelResultStore;

  constructor(private readonly dependencies: ApiServiceDependencies) {
    this.resultStore = dependencies.resultStore ?? new ChannelResultStore();
  }

  getRuntimeIdentity() {
    const providerConfig = resolveApiProviderConfig(this.dependencies.loadedConfig.raw.bots.api);
    return {
      botId: "listener",
      label: `${providerConfig.defaults.listener.host}:${providerConfig.defaults.listener.port}`,
    };
  }

  async start() {
    const providerConfig = resolveApiProviderConfig(this.dependencies.loadedConfig.raw.bots.api);
    this.server = Bun.serve({
      hostname: providerConfig.defaults.listener.host,
      port: providerConfig.defaults.listener.port,
      fetch: (request, server) =>
        this.handleRequest(
          request,
          server.requestIP(request)?.address ?? undefined,
        ),
    });
  }

  async stop() {
    this.server?.stop(true);
    this.server = undefined;
  }

  async handleRequest(request: Request, remoteAddress?: string | null) {
    return handleApiRequest({
      request,
      remoteAddress,
      loadedConfig: this.dependencies.loadedConfig,
      agentService: this.dependencies.agentService,
      resultStore: this.resultStore,
    });
  }
}

export async function handleApiRequest(params: {
  request: Request;
  remoteAddress?: string | null;
  loadedConfig: LoadedConfig;
  agentService: AgentService;
  resultStore: ChannelResultStore;
}) {
  const url = new URL(params.request.url);
  const route = parseApiPath(url.pathname);
  if (!route) {
    return jsonResponse({ error: "not_found" }, { status: 404 });
  }
  const botConfig = resolveApiBotConfig(params.loadedConfig.raw.bots.api, route.botId);
  if (route.kind === "event-result") {
    return handleResultRequest({ ...params, botId: route.botId, eventId: route.eventId, botConfig });
  }
  if (route.kind === "event-stop") {
    return handleEventStopRequest({ ...params, botId: route.botId, eventId: route.eventId, botConfig });
  }
  if (route.kind === "surface-stop") {
    return handleSurfaceStopRequest({ ...params, botId: route.botId, surfaceId: route.surfaceId, botConfig });
  }
  if (params.request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  return handleEventRequest({ ...params, botId: route.botId, botConfig });
}

async function handleResultRequest(params: Parameters<typeof handleApiRequest>[0] & {
  botId: string;
  eventId: string;
  botConfig: ReturnType<typeof resolveApiBotConfig>;
}) {
  if (params.request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  const authorized = authorizeApiBotRequest(params.botConfig.ingress.auth, {
    headers: params.request.headers,
    rawBody: "",
    remoteAddress: params.remoteAddress,
  });
  if (!authorized) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }
  const record = await params.resultStore.getResult({
    channel: "api",
    botId: params.botId,
    eventId: params.eventId,
  });
  return record
    ? jsonResponse(record, { status: 200 })
    : jsonResponse({ error: "not_found" }, { status: 404 });
}

async function handleEventRequest(params: Parameters<typeof handleApiRequest>[0] & {
  botId: string;
  botConfig: ReturnType<typeof resolveApiBotConfig>;
}) {
  const rawBody = await params.request.text();
  const authorized = authorizeApiBotRequest(params.botConfig.ingress.auth, {
    headers: params.request.headers,
    rawBody,
    remoteAddress: params.remoteAddress,
  });
  if (!authorized) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  let mapped: ApiMappedEvent;
  try {
    mapped = normalizeMappedEvent(evaluateApiMapObject(params.botConfig.ingress.map, payload));
  } catch (error) {
    return jsonResponse({ error: "invalid_mapping", detail: String(error) }, { status: 400 });
  }

  const existing = await params.resultStore.getResult({
    channel: "api",
    botId: params.botId,
    eventId: mapped.eventId,
  });
  if (existing) {
    return jsonResponse({
      ...buildAcceptanceBody(existing),
      status: "duplicate",
    }, { status: params.botConfig.ingress.successStatusCode });
  }

  const baseRecord = await params.resultStore.createResult({
    channel: "api",
    botId: params.botId,
    eventId: mapped.eventId,
    surfaceId: mapped.surfaceId,
    surfaceKind: mapped.surfaceKind,
    reply: {
      targetId: mapped.replyTargetId,
      params: mapped.replyParams,
    },
  });

  if (!evaluateApiFilter(params.botConfig.ingress.filter, payload)) {
    const filtered = await params.resultStore.updateStatus({
      channel: "api",
      botId: params.botId,
      eventId: mapped.eventId,
      status: "filtered",
    }) ?? baseRecord;
    return jsonResponse(buildAcceptanceBody(filtered), {
      status: params.botConfig.ingress.successStatusCode,
    });
  }

  const resolvedRoute = resolveApiConversationRoute({
    loadedConfig: params.loadedConfig,
    botId: params.botId,
    surfaceKind: mapped.surfaceKind,
    surfaceId: mapped.surfaceId,
  });
  if (!resolvedRoute.route) {
    const failed = await params.resultStore.updateStatus({
      channel: "api",
      botId: params.botId,
      eventId: mapped.eventId,
      status: "failed",
      error: {
        code: "route_not_admitted",
        message: `API surface route is ${resolvedRoute.status}`,
        category: "route",
      },
    }) ?? baseRecord;
    return jsonResponse(buildAcceptanceBody(failed), {
      status: params.botConfig.ingress.successStatusCode,
    });
  }

  const accepted = await acceptMappedApiEvent({
    ...params,
    mapped,
    route: resolvedRoute.route,
  });
  return jsonResponse(buildAcceptanceBody(accepted), {
    status: params.botConfig.ingress.successStatusCode,
  });
}

async function acceptMappedApiEvent(params: Parameters<typeof handleEventRequest>[0] & {
  mapped: ApiMappedEvent;
  route: NonNullable<ReturnType<typeof resolveApiConversationRoute>["route"]>;
}): Promise<ChannelResultRecord> {
  const principalProviderId = `${params.botId}:${params.mapped.senderId}`;
  const identity = {
    platform: "api" as const,
    botId: params.botId,
    conversationKind: params.mapped.surfaceKind,
    senderId: principalProviderId,
    senderName: params.mapped.senderDisplayName,
    chatId: params.mapped.surfaceKind === "dm" ? params.mapped.surfaceId : undefined,
    channelId: params.mapped.surfaceKind === "group" ? params.mapped.surfaceId : undefined,
  };
  const auth = resolveChannelAuth({
    config: params.loadedConfig.raw,
    agentId: params.route.agentId,
    identity,
  });
  if (
    isChannelSenderBlocked({
      channel: "api",
      blockFrom: params.route.blockUsers ?? [],
      subject: { userId: principalProviderId },
    }) ||
    (
      !auth.mayBypassSharedSenderPolicy &&
      (params.route.policy === "allowlist" || (params.route.allowUsers?.length ?? 0) > 0) &&
      !isChannelSenderAllowed({
        channel: "api",
        allowFrom: params.route.allowUsers ?? [],
        subject: { userId: principalProviderId },
      })
    )
  ) {
    const failed = await params.resultStore.updateStatus({
      channel: "api",
      botId: params.botId,
      eventId: params.mapped.eventId,
      status: "failed",
      error: {
        code: "sender_not_allowed",
        message: "API sender is not allowed for this route.",
        category: "auth",
      },
    });
    return failed ?? (await params.resultStore.getResult({
      channel: "api",
      botId: params.botId,
      eventId: params.mapped.eventId,
    }))!;
  }

  const sessionTarget = resolveApiConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: params.route.agentId,
    botId: params.botId,
    surfaceKind: params.mapped.surfaceKind,
    surfaceId: params.mapped.surfaceId,
  });
  const sessionBusy = await params.agentService.isAwaitingFollowUpRouting(sessionTarget);
  const canSteer = params.agentService.canSteerActiveRun(sessionTarget);
  const status = params.mapped.runMode === "steer" && sessionBusy && canSteer ? "steered" : "queued";
  await params.resultStore.updateContext({
    channel: "api",
    botId: params.botId,
    eventId: params.mapped.eventId,
    surfaceId: params.mapped.surfaceId,
    surfaceKind: params.mapped.surfaceKind,
    agentId: params.route.agentId,
    sessionKey: sessionTarget.sessionKey,
  });
  const record = await params.resultStore.updateStatus({
    channel: "api",
    botId: params.botId,
    eventId: params.mapped.eventId,
    status,
  });
  const promptContext = buildSurfacePromptContext({
    identity,
    agentId: params.route.agentId,
  });
  const protectedControlMutationRule = auth.mayManageProtectedResources
    ? undefined
    : DEFAULT_PROTECTED_CONTROL_RULE;
  const route = {
    ...params.route,
    additionalMessageMode: params.mapped.runMode ?? params.route.additionalMessageMode,
  };
  const buildPrompt = (text: string) => appendApiReplyToPrompt(
    buildAgentPromptText({
      text,
      identity,
      config: params.botConfig.agentPrompt,
      responseMode: route.responseMode,
      streaming: route.streaming,
      protectedControlMutationRule,
      agentId: route.agentId,
      promptContext,
    }),
    params.mapped.eventId,
  );
  void processApiInteraction({
    ...params,
    identity,
    auth,
    route,
    sessionTarget,
    protectedControlMutationRule,
    promptContext,
    buildPrompt,
  });
  return record!;
}

async function processApiInteraction(params: Parameters<typeof acceptMappedApiEvent>[0] & {
  identity: any;
  auth: any;
  route: any;
  sessionTarget: ReturnType<typeof resolveApiConversationTarget>;
  protectedControlMutationRule?: string;
  promptContext: ReturnType<typeof buildSurfacePromptContext>;
  buildPrompt: (text: string) => string;
}) {
  let lastText = "";
  try {
    await processChannelInteraction({
      agentService: params.agentService,
      sessionTarget: params.sessionTarget,
      identity: params.identity,
      auth: params.auth,
      senderId: params.identity.senderId,
      text: params.mapped.text,
      agentPromptText: params.buildPrompt(params.mapped.text),
      agentPromptBuilder: (text) => params.buildPrompt(text),
      promptContext: params.promptContext,
      protectedControlMutationRule: params.protectedControlMutationRule,
      route: params.route,
      maxChars: params.agentService.getMaxMessageChars(params.route.agentId),
      onPromptAccepted: async () => {
        await params.resultStore.updateStatus({
          channel: "api",
          botId: params.botId,
          eventId: params.mapped.eventId,
          status: params.mapped.runMode === "steer" ? "steered" : "processing",
        });
      },
      postText: async (text) => {
        lastText = text;
        await params.resultStore.updateStatus({
          channel: "api",
          botId: params.botId,
          eventId: params.mapped.eventId,
          status: "processing",
        });
        const updated = await params.resultStore.appendOutput({
          channel: "api",
          botId: params.botId,
          eventId: params.mapped.eventId,
          kind: "progress",
          text,
          render: "text",
        });
        return updated?.progress.slice(-1) ?? [];
      },
      reconcileText: async (_chunks, text) => {
        lastText = text;
        if (!text.trim()) {
          return [];
        }
        const updated = await params.resultStore.appendOutput({
          channel: "api",
          botId: params.botId,
          eventId: params.mapped.eventId,
          kind: "progress",
          text,
          render: "text",
        });
        return updated?.progress.slice(-1) ?? [];
      },
    });
    const latest = await params.resultStore.getResult({
      channel: "api",
      botId: params.botId,
      eventId: params.mapped.eventId,
    });
    if (latest && !latest.result && lastText.trim()) {
      await params.resultStore.appendOutput({
        channel: "api",
        botId: params.botId,
        eventId: params.mapped.eventId,
        kind: "final",
        text: lastText,
        render: "text",
      });
    }
  } catch (error) {
    const latest = await params.resultStore.getResult({
      channel: "api",
      botId: params.botId,
      eventId: params.mapped.eventId,
    });
    if (latest?.status === "stopped") {
      return;
    }
    await params.resultStore.updateStatus({
      channel: "api",
      botId: params.botId,
      eventId: params.mapped.eventId,
      status: "failed",
      error: sanitizeError(error),
    });
  }
}

export function isApiChannelEnabled(loadedConfig: LoadedConfig) {
  const apiConfig = resolveApiProviderConfig(loadedConfig.raw.bots.api);
  return apiConfig.defaults.enabled && listApiBotIds(apiConfig).length > 0;
}

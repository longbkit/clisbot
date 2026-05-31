import { ChannelResultStore, type ChannelResultRender } from "../results/result-store.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { ParsedMessageCommand } from "../message/message-command.ts";
import { evaluateApiMapValue } from "./mapper.ts";
import { resolveApiBotConfig } from "./config.ts";
import { resolveApiSurface } from "./surface.ts";

type FetchLike = typeof fetch;

function assertTextMessage(command: ParsedMessageCommand) {
  if (command.media) {
    throw new Error("API channel message.send does not support files or media in the first slice.");
  }
  const text = command.message?.trim();
  if (!text) {
    throw new Error("--message or --body-file is required for api message send");
  }
  return text;
}

function resolveRender(command: ParsedMessageCommand, nativeRender: "text" | "markdown"): ChannelResultRender {
  if (command.renderMode === "native") {
    return nativeRender;
  }
  if (command.renderMode === "none") {
    return command.inputFormat === "plain" ? "text" : "markdown";
  }
  if (command.renderMode === "html" || command.renderMode === "blocks" || command.renderMode === "mrkdwn") {
    throw new Error(`API channel does not support --render ${command.renderMode}`);
  }
  return command.inputFormat === "plain" ? "text" : "markdown";
}

function outputKind(command: ParsedMessageCommand) {
  return command.progress ? "progress" as const : command.final ? "final" as const : "progress" as const;
}

function buildTemplateContext(params: {
  text: string;
  render: ChannelResultRender;
  targetId?: string;
  replyParams?: Record<string, unknown>;
}) {
  return {
    env: process.env,
    message: {
      text: params.text,
      render: params.render,
    },
    reply: {
      targetId: params.targetId,
      params: params.replyParams ?? {},
    },
  };
}

function sanitizeHeaders(headers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]),
  );
}

async function resolveApiMessageEvent(params: {
  command: ParsedMessageCommand;
  resultStore: ChannelResultStore;
  botId: string;
  surfaceId: string;
}) {
  const explicitEventId = params.command.replyTo?.trim();
  if (explicitEventId) {
    return { eventId: explicitEventId, surfaceReply: null };
  }
  const surfaceReply = await params.resultStore.resolveSurfaceReply({
    channel: "api",
    botId: params.botId,
    surfaceId: params.surfaceId,
  });
  if (!surfaceReply?.activeEventId) {
    throw new Error("No API event result is active for this target. Pass --reply-to <eventId> or ingest an event first.");
  }
  return { eventId: surfaceReply.activeEventId, surfaceReply };
}

export async function sendApiMessage(params: {
  loadedConfig: LoadedConfig;
  command: ParsedMessageCommand;
  botId: string;
  resultStore?: ChannelResultStore;
  fetch?: FetchLike;
}) {
  const text = assertTextMessage(params.command);
  const surface = resolveApiSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
  });
  if (!surface) {
    throw new Error("API target must use dm:<surface-id> or group:<surface-id>.");
  }
  const botConfig = resolveApiBotConfig(params.loadedConfig.raw.bots.api, params.botId);
  const action = botConfig.actions?.["message.send"];
  const resultStore = params.resultStore ?? new ChannelResultStore();
  const eventContext = await resolveApiMessageEvent({
    command: params.command,
    resultStore,
    botId: params.botId,
    surfaceId: surface.provider.surfaceId,
  });
  const render = resolveRender(params.command, action?.rendering?.native ?? "markdown");
  const updated = await resultStore.appendOutput({
    channel: "api",
    botId: params.botId,
    eventId: eventContext.eventId,
    kind: outputKind(params.command),
    text,
    render,
  });
  if (!updated) {
    throw new Error(`Unknown API event result: ${params.botId}/${eventContext.eventId}`);
  }
  if (!action) {
    return {
      ok: true,
      channel: "api",
      botId: params.botId,
      eventId: eventContext.eventId,
      delivered: false,
      result: updated,
    };
  }

  const context = buildTemplateContext({
    text,
    render,
    targetId: updated.reply?.targetId ?? eventContext.surfaceReply?.targetId ?? surface.provider.surfaceId,
    replyParams: updated.reply?.params ?? eventContext.surfaceReply?.params,
  });
  const response = await (params.fetch ?? fetch)(String(evaluateApiMapValue(action.url, {}, undefined, context)), {
    method: action.method,
    headers: {
      "content-type": "application/json",
      ...sanitizeHeaders(evaluateApiMapValue(action.headers ?? {}, {}, undefined, context) as Record<string, unknown>),
    },
    body: action.body === undefined
      ? undefined
      : JSON.stringify(evaluateApiMapValue(action.body, {}, undefined, context)),
  });
  return {
    ok: response.ok,
    channel: "api",
    botId: params.botId,
    eventId: eventContext.eventId,
    delivered: response.ok,
    providerStatus: response.status,
    result: updated,
  };
}

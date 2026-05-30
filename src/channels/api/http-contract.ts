import type { ChannelResultRecord } from "../results/result-store.ts";

export type ApiPath =
  | { kind: "event-ingress"; botId: string }
  | { kind: "event-result"; botId: string; eventId: string }
  | { kind: "event-stop"; botId: string; eventId: string }
  | { kind: "surface-stop"; botId: string; surfaceId: string };

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function parseApiPath(pathname: string): ApiPath | null {
  const eventRoot = /^\/api\/bots\/([^/]+)\/events$/.exec(pathname);
  if (eventRoot) {
    return { kind: "event-ingress", botId: decodeURIComponent(eventRoot[1]!) };
  }
  const eventChild = /^\/api\/bots\/([^/]+)\/events\/([^/]+)\/(result|stop)$/.exec(pathname);
  if (eventChild) {
    return {
      kind: eventChild[3] === "result" ? "event-result" : "event-stop",
      botId: decodeURIComponent(eventChild[1]!),
      eventId: decodeURIComponent(eventChild[2]!),
    };
  }
  const surfaceStop = /^\/api\/bots\/([^/]+)\/surfaces\/([^/]+)\/stop$/.exec(pathname);
  if (surfaceStop) {
    return {
      kind: "surface-stop",
      botId: decodeURIComponent(surfaceStop[1]!),
      surfaceId: decodeURIComponent(surfaceStop[2]!),
    };
  }
  return null;
}

export function resultUrl(botId: string, eventId: string) {
  return `/api/bots/${encodeURIComponent(botId)}/events/${encodeURIComponent(eventId)}/result`;
}

export function buildAcceptanceBody(record: {
  channel: string;
  botId: string;
  eventId: string;
  status: string;
  expiresAt: string;
}) {
  return {
    channel: record.channel,
    botId: record.botId,
    eventId: record.eventId,
    status: record.status,
    resultUrl: resultUrl(record.botId, record.eventId),
    expiresAt: record.expiresAt,
  };
}

export function isTerminalResultStatus(status: ChannelResultRecord["status"]) {
  return ["completed", "failed", "filtered", "expired", "stopped"].includes(status);
}

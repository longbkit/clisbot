import type { ChannelResultRecord } from "../results/result-store.ts";

export type ApiPath =
  | { kind: "event-ingress"; botId: string }
  | { kind: "event-result"; botId: string; eventId: string }
  | { kind: "event-stop"; botId: string; eventId: string }
  | { kind: "surface-stop"; botId: string; surfaceId: string }
  | { kind: "sessions-list"; botId: string }
  | { kind: "session-events"; botId: string; sessionKey: string }
  | { kind: "demo-page"; botId: string };

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
  const sessionsRoot = /^\/api\/bots\/([^/]+)\/sessions$/.exec(pathname);
  if (sessionsRoot) {
    return { kind: "sessions-list", botId: decodeURIComponent(sessionsRoot[1]!) };
  }
  const sessionEvents = /^\/api\/bots\/([^/]+)\/sessions\/([^/]+)\/events$/.exec(pathname);
  if (sessionEvents) {
    return {
      kind: "session-events",
      botId: decodeURIComponent(sessionEvents[1]!),
      sessionKey: decodeURIComponent(sessionEvents[2]!),
    };
  }
  const demoPage = /^\/api\/bots\/([^/]+)\/demo$/.exec(pathname);
  if (demoPage) {
    return { kind: "demo-page", botId: decodeURIComponent(demoPage[1]!) };
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

import { isValidLoopTimezone } from "../agents/loop-command.ts";
import type { ClisbotConfig } from "./schema.ts";

export type TimezoneSource =
  | "loop"
  | "route"
  | "agent"
  | "bot"
  | "app"
  | "legacy-loop-default"
  | "legacy-bots-default"
  | "legacy-provider-default"
  | "host";

export type ResolvedTimezone = {
  timezone: string;
  source: TimezoneSource;
};

type TimezoneCandidate = {
  source: TimezoneSource;
  timezone?: string;
};

function normalizeTimezone(raw: unknown) {
  const timezone = typeof raw === "string" ? raw.trim() : "";
  return timezone && isValidLoopTimezone(timezone) ? timezone : undefined;
}

export function parseTimezone(raw: string | undefined, label = "timezone") {
  const timezone = normalizeTimezone(raw);
  if (!timezone) {
    throw new Error(`Expected ${label} to be a valid IANA timezone such as Asia/Ho_Chi_Minh.`);
  }
  return timezone;
}

export function getHostTimezone() {
  return normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
}

export function formatTimezoneLocalTime(timezone: string, date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${formatter.format(date).replace(",", "")} ${timezone}`;
}

export function resolveTimezone(candidates: TimezoneCandidate[]): ResolvedTimezone {
  for (const candidate of candidates) {
    const timezone = normalizeTimezone(candidate.timezone);
    if (timezone) {
      return {
        timezone,
        source: candidate.source,
      };
    }
  }
  return {
    timezone: getHostTimezone(),
    source: "host",
  };
}

export function resolveConfigTimezone(params: {
  config: ClisbotConfig;
  agentId?: string;
  routeTimezone?: string;
  botTimezone?: string;
  loopTimezone?: string;
}): ResolvedTimezone {
  const agentTimezone = params.agentId
    ? params.config.agents.list.find((agent) => agent.id === params.agentId)?.timezone
    : undefined;
  return resolveTimezone([
    { source: "loop", timezone: params.loopTimezone },
    { source: "route", timezone: params.routeTimezone },
    { source: "agent", timezone: agentTimezone },
    { source: "bot", timezone: params.botTimezone },
    { source: "app", timezone: params.config.app.timezone },
    {
      source: "legacy-loop-default",
      timezone: params.config.app.control.loop.defaultTimezone,
    },
    { source: "legacy-bots-default", timezone: params.config.bots.defaults.timezone },
    {
      source: "legacy-provider-default",
      timezone: params.config.bots.slack.defaults.timezone,
    },
    {
      source: "legacy-provider-default",
      timezone: params.config.bots.telegram.defaults.timezone,
    },
  ]);
}

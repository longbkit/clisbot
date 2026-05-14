import { parseCommandDurationMs } from "../session/run-observation.ts";
export const DEFAULT_LOOP_MAX_TIMES = 50;
export const LOOP_FORCE_FLAG = "--force";
export const LOOP_START_FLAG = "--loop-start";
export const LOOP_ALL_FLAG = "--all";
export const LOOP_APP_FLAG = "--app";
export const MIN_LOOP_INTERVAL_MS = 60_000;
export const FORCE_LOOP_INTERVAL_MS = 5 * 60_000;
const LOOP_START_MODES = ["none", "brief", "full"] as const;

const LOOP_WEEKDAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const LOOP_WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export type LoopCalendarCadence = "daily" | "weekday" | "day-of-week";
export type LoopStartNotificationMode = (typeof LOOP_START_MODES)[number];

export type ParsedLoopSlashCommand =
  | {
      mode: "interval";
      intervalMs: number;
      promptText?: string;
      force: boolean;
      syntax: "leading-interval" | "every-clause";
      loopStart?: LoopStartNotificationMode;
    }
  | {
      mode: "times";
      count: number;
      promptText?: string;
      force: boolean;
      syntax: "leading-count" | "trailing-times";
    }
  | {
      mode: "calendar";
      cadence: LoopCalendarCadence;
      dayOfWeek?: number;
      localTime: string;
      hour: number;
      minute: number;
      promptText?: string;
      force: false;
      syntax: "calendar-at";
      loopStart?: LoopStartNotificationMode;
    };

export type ParsedLoopSlashCommandResult =
  | ParsedLoopSlashCommand
  | {
      error: string;
    };

export function parseLoopSlashCommand(raw: string): ParsedLoopSlashCommandResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      error:
        "Loop requires an interval, count, or schedule. Try `/loop 5m check CI`, `/loop 3 check CI`, `/loop every day at 07:00 check CI`, or `/loop 3` for maintenance mode.",
    };
  }

  const modifier = extractLoopStartModifier(trimmed);
  if ("error" in modifier) {
    return modifier;
  }

  const normalizedText = modifier.normalizedText;
  const tokens = modifier.normalizedText.split(/\s+/).filter(Boolean);
  const forceTokenIndexes = tokens
    .map((token, index) => (token.toLowerCase() === LOOP_FORCE_FLAG ? index : -1))
    .filter((index) => index >= 0);
  if (forceTokenIndexes.length > 1) {
    return {
      error: `Loop accepts at most one \`${LOOP_FORCE_FLAG}\` flag.`,
    };
  }

  const forceTokenIndex = forceTokenIndexes[0];
  const leadingToken = tokens[0] ?? "";

  const everyDayMatch = normalizedText.match(/^every\s+day\s+at\s+(\S+)(?:\s+(.*))?$/i);
  if (everyDayMatch) {
    if (forceTokenIndex !== undefined) {
      return {
        error: `\`${LOOP_FORCE_FLAG}\` is only supported for interval loops.`,
      };
    }
    const parsedTime = parseLoopClockTime(everyDayMatch[1] ?? "");
    if (!parsedTime) {
      return {
        error: "Loop wall-clock time must use `HH:MM` in 24-hour format.",
      };
    }
    const parsed: Extract<ParsedLoopSlashCommand, { mode: "calendar" }> = {
      mode: "calendar",
      cadence: "daily",
      localTime: parsedTime.localTime,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      promptText: everyDayMatch[2]?.trim() || undefined,
      force: false,
      syntax: "calendar-at",
    };
    const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
    if (validationError) {
      return {
        error: validationError,
      };
    }
    return {
      ...parsed,
      ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
    };
  }

  const everyWeekdayMatch = normalizedText.match(/^every\s+weekday\s+at\s+(\S+)(?:\s+(.*))?$/i);
  if (everyWeekdayMatch) {
    if (forceTokenIndex !== undefined) {
      return {
        error: `\`${LOOP_FORCE_FLAG}\` is only supported for interval loops.`,
      };
    }
    const parsedTime = parseLoopClockTime(everyWeekdayMatch[1] ?? "");
    if (!parsedTime) {
      return {
        error: "Loop wall-clock time must use `HH:MM` in 24-hour format.",
      };
    }
    const parsed: Extract<ParsedLoopSlashCommand, { mode: "calendar" }> = {
      mode: "calendar",
      cadence: "weekday",
      localTime: parsedTime.localTime,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      promptText: everyWeekdayMatch[2]?.trim() || undefined,
      force: false,
      syntax: "calendar-at",
    };
    const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
    if (validationError) {
      return {
        error: validationError,
      };
    }
    return {
      ...parsed,
      ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
    };
  }

  const everyDayOfWeekMatch = normalizedText.match(/^every\s+([a-z]+)\s+at\s+(\S+)(?:\s+(.*))?$/i);
  if (everyDayOfWeekMatch) {
    const dayOfWeek = resolveLoopDayOfWeek(everyDayOfWeekMatch[1] ?? "");
    if (dayOfWeek != null) {
      if (forceTokenIndex !== undefined) {
        return {
          error: `\`${LOOP_FORCE_FLAG}\` is only supported for interval loops.`,
        };
      }
      const parsedTime = parseLoopClockTime(everyDayOfWeekMatch[2] ?? "");
      if (!parsedTime) {
        return {
          error: "Loop wall-clock time must use `HH:MM` in 24-hour format.",
        };
      }
      const parsed: Extract<ParsedLoopSlashCommand, { mode: "calendar" }> = {
        mode: "calendar",
        cadence: "day-of-week",
        dayOfWeek,
        localTime: parsedTime.localTime,
        hour: parsedTime.hour,
        minute: parsedTime.minute,
        promptText: everyDayOfWeekMatch[3]?.trim() || undefined,
        force: false,
        syntax: "calendar-at",
      };
      const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
      if (validationError) {
        return {
          error: validationError,
        };
      }
      return {
        ...parsed,
        ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
      };
    }
  }

  const leadingIntervalMs = parseCommandDurationMs(leadingToken);
  if (leadingIntervalMs) {
    if (forceTokenIndex !== undefined && forceTokenIndex !== 1) {
      return {
        error: `For interval loops, \`${LOOP_FORCE_FLAG}\` must appear immediately after the interval, for example \`/loop 1m --force check CI\`.`,
      };
    }
    const promptTokens = tokens.slice(forceTokenIndex === 1 ? 2 : 1);
    const promptText = promptTokens.join(" ").trim() || undefined;
    const parsed: Extract<ParsedLoopSlashCommand, { mode: "interval" }> = {
      mode: "interval",
      intervalMs: leadingIntervalMs,
      promptText,
      force: forceTokenIndex === 1,
      syntax: "leading-interval",
    };
    const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
    if (validationError) {
      return {
        error: validationError,
      };
    }
    return {
      ...parsed,
      ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
    };
  }

  if (/^-?\d+$/.test(leadingToken)) {
    if (modifier.loopStart) {
      return {
        error: `\`${LOOP_START_FLAG}\` is only supported for recurring interval and wall-clock loops.`,
      };
    }
    if (forceTokenIndex !== undefined) {
      return {
        error: `\`${LOOP_FORCE_FLAG}\` is only supported for interval loops.`,
      };
    }
    const count = Number.parseInt(leadingToken, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return {
        error: "Loop count must be a positive integer.",
      };
    }
    const promptText = tokens.slice(1).join(" ").trim() || undefined;
    return {
      mode: "times",
      count,
      promptText,
      force: false,
      syntax: "leading-count",
    };
  }

  const trailingTimes = normalizedText.match(/^(.*?)(?:\s+)?(-?\d+)\s+times$/i);
  if (trailingTimes) {
    if (modifier.loopStart) {
      return {
        error: `\`${LOOP_START_FLAG}\` is only supported for recurring interval and wall-clock loops.`,
      };
    }
    if (forceTokenIndex !== undefined) {
      return {
        error: `\`${LOOP_FORCE_FLAG}\` is only supported for interval loops.`,
      };
    }
    const count = Number.parseInt(trailingTimes[2] ?? "", 10);
    if (!Number.isFinite(count) || count <= 0) {
      return {
        error: "Loop count must be a positive integer.",
      };
    }
    const promptText = trailingTimes[1]?.trim() || undefined;
    return {
      mode: "times",
      count,
      promptText,
      force: false,
      syntax: "trailing-times",
    };
  }

  const withoutTrailingForce =
    forceTokenIndex === tokens.length - 1
      ? tokens.slice(0, -1).join(" ")
      : normalizedText;
  const normalizedEveryInput = withoutTrailingForce.trim();
  const hasTrailingForce = forceTokenIndex === tokens.length - 1;
  if (forceTokenIndex !== undefined && !hasTrailingForce) {
    return {
      error: `For \`every ...\` interval loops, \`${LOOP_FORCE_FLAG}\` must appear at the end, for example \`/loop check CI every 1m --force\`.`,
    };
  }

  const everyCompactClause = normalizedEveryInput.match(/^(.*?)(?:\s+)?every\s+([0-9]+[a-z]+)$/i);
  if (everyCompactClause) {
    const intervalMs = parseCommandDurationMs(everyCompactClause[2] ?? "");
    if (!intervalMs) {
      return {
        error: "Loop interval must be a positive duration.",
      };
    }

    const promptText = everyCompactClause[1]?.trim() || undefined;
    const parsed: Extract<ParsedLoopSlashCommand, { mode: "interval" }> = {
      mode: "interval",
      intervalMs,
      promptText,
      force: hasTrailingForce,
      syntax: "every-clause",
    };
    const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
    if (validationError) {
      return {
        error: validationError,
      };
    }
    return {
      ...parsed,
      ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
    };
  }

  const everyClause = normalizedEveryInput.match(/^(.*?)(?:\s+)?every\s+(-?\d+)\s+([a-z]+)$/i);
  if (everyClause) {
    const amount = Number.parseInt(everyClause[2] ?? "", 10);
    const unit = everyClause[3] ?? "";
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        error: "Loop interval must be a positive duration.",
      };
    }

    const intervalMs = parseWordDurationMs(amount, unit);
    if (!intervalMs) {
      return {
        error: "Loop interval must use a supported unit such as seconds, minutes, or hours.",
      };
    }

    const promptText = everyClause[1]?.trim() || undefined;
    const parsed: Extract<ParsedLoopSlashCommand, { mode: "interval" }> = {
      mode: "interval",
      intervalMs,
      promptText,
      force: hasTrailingForce,
      syntax: "every-clause",
    };
    const validationError = validateLoopStartModifierPlacement(parsed, modifier, modifier.tokens.length);
    if (validationError) {
      return {
        error: validationError,
      };
    }
    return {
      ...parsed,
      ...(modifier.loopStart ? { loopStart: modifier.loopStart } : {}),
    };
  }

  return {
    error:
      "Loop requires an interval, count, or schedule. Try `/loop 5m check CI`, `/loop 3 check CI`, `/loop every day at 07:00 check CI`, or `/loop 3` for maintenance mode.",
  };
}

type ExtractedLoopStartModifier =
  | {
      normalizedText: string;
      tokens: string[];
      loopStart?: LoopStartNotificationMode;
      flagIndex?: number;
    }
  | {
      error: string;
    };

function extractLoopStartModifier(raw: string): ExtractedLoopStartModifier {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const indexes = tokens
    .map((token, index) => token.trim().toLowerCase() === LOOP_START_FLAG ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) {
    return {
      error: `Loop accepts at most one \`${LOOP_START_FLAG}\` flag.`,
    };
  }
  const flagIndex = indexes[0];
  if (flagIndex == null) {
    return {
      normalizedText: raw,
      tokens,
    };
  }
  const rawMode = tokens[flagIndex + 1]?.trim().toLowerCase();
  if (!rawMode) {
    return {
      error: `Loop requires \`${LOOP_START_FLAG} <none|brief|full>\`.`,
    };
  }
  if (!LOOP_START_MODES.includes(rawMode as LoopStartNotificationMode)) {
    return {
      error: `\`${LOOP_START_FLAG}\` must be one of \`none\`, \`brief\`, or \`full\`.`,
    };
  }
  const strippedTokens = tokens.filter((_, index) => index !== flagIndex && index !== flagIndex + 1);
  return {
    normalizedText: strippedTokens.join(" "),
    tokens,
    flagIndex,
    loopStart: rawMode as LoopStartNotificationMode,
  };
}

function validateLoopStartModifierPlacement(
  parsed: Extract<ParsedLoopSlashCommand, { mode: "interval" | "calendar" }>,
  modifier: Exclude<ExtractedLoopStartModifier, { error: string }>,
  tokenCount: number,
) {
  if (!modifier.loopStart || modifier.flagIndex == null) {
    return undefined;
  }
  if (parsed.mode === "calendar") {
    if (modifier.flagIndex === 4) {
      return undefined;
    }
    return `For wall-clock loops, \`${LOOP_START_FLAG}\` must appear immediately after the \`at HH:MM\` clause, for example \`/loop every day at 07:00 --loop-start none morning brief\`.`;
  }
  if (parsed.syntax === "leading-interval") {
    const expectedIndex = parsed.force ? 2 : 1;
    if (modifier.flagIndex === expectedIndex) {
      return undefined;
    }
    return `For leading interval loops, \`${LOOP_START_FLAG}\` must appear after the interval and optional \`${LOOP_FORCE_FLAG}\`, before the prompt, for example \`/loop 5m --loop-start none check CI\`.`;
  }
  if (modifier.flagIndex === tokenCount - 2) {
    return undefined;
  }
  return `For \`every ...\` interval loops, \`${LOOP_START_FLAG}\` must appear at the end of the loop schedule, for example \`/loop check deploy every 2h --loop-start none\`.`;
}

export function formatLoopIntervalShort(intervalMs: number) {
  if (intervalMs % (60 * 60_000) === 0) {
    return `${intervalMs / (60 * 60_000)}h`;
  }
  if (intervalMs % 60_000 === 0) {
    return `${intervalMs / 60_000}m`;
  }
  if (intervalMs % 1000 === 0) {
    return `${intervalMs / 1000}s`;
  }
  return `${intervalMs}ms`;
}

export function renderLoopHelpLines() {
  return [
    "- `/loop 5m check CI`: run the prompt every 5 minutes",
    "- `/loop 1m --force check CI`: run the prompt every 1 minute",
    "- `/loop check deploy every 2h`: run the prompt every 2 hours",
    "- `/loop check deploy every 1m --force`: run the prompt every 1 minute",
    "- `/loop every day at 07:00 check CI`: run the prompt every day at 07:00",
    "- `/loop every weekday at 07:00 standup`: run the prompt every weekday at 07:00",
    "- `/loop every mon at 09:00 weekly review`: run the prompt every Monday at 09:00",
    "- `/loop 5m`: run the maintenance loop every 5 minutes using `LOOP.md`",
    "- `/loop every day at 07:00`: run the maintenance loop every day at 07:00 using `LOOP.md`",
    "- `/loop 3 check CI`: run the prompt 3 times",
    "- `/loop 3`: run the maintenance loop 3 times using `LOOP.md`",
    "- `/loop 3 /codereview`: run the slash command 3 times",
    "- `/loop /codereview 3 times`: run the slash command 3 times",
    "- `/loop status`: show active loops for this session",
    `- \`/loop cancel\`, \`/loop cancel <id>\`, \`/loop cancel --all\`, \`/loop cancel --all ${LOOP_APP_FLAG}\`: cancel active loops`,
    `- intervals must be at least \`1m\`; intervals below \`5m\` require \`${LOOP_FORCE_FLAG}\` right after the interval clause; wall-clock schedules use \`every ... at HH:MM\`; the first wall-clock loop created with \`clisbot loops create\` requires \`--confirm\`; timezone resolves from route/topic, agent, bot, app timezone, then legacy defaults and host; bare numbers mean times, compact durations such as \`5m\` mean intervals, and the historical default loop cap was \`${DEFAULT_LOOP_MAX_TIMES}\``,
    `- Advanced: loop creation also accepts \`${LOOP_START_FLAG} <none|brief|full>\` to override the default start notification behavior for that loop. Example: \`/loop every day at 07:00 --loop-start none morning brief\``,
  ];
}

export function hasLoopFlag(raw: string, flag: string) {
  return raw.split(/\s+/).some((token) => token.trim().toLowerCase() === flag.toLowerCase());
}

export function resolveLoopDayOfWeek(raw: string) {
  return LOOP_WEEKDAY_ALIASES[raw.trim().toLowerCase()];
}

export function formatLoopDayOfWeek(dayOfWeek: number) {
  return LOOP_WEEKDAY_LABELS[dayOfWeek] ?? `day-${dayOfWeek}`;
}

export function formatCalendarLoopSchedule(params: {
  cadence: LoopCalendarCadence;
  dayOfWeek?: number;
  localTime: string;
}) {
  if (params.cadence === "daily") {
    return `every day at ${params.localTime}`;
  }
  if (params.cadence === "weekday") {
    return `every weekday at ${params.localTime}`;
  }
  return `every ${formatLoopDayOfWeek(params.dayOfWeek ?? 0)} at ${params.localTime}`;
}

export function isValidLoopTimezone(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function computeNextCalendarLoopRunAtMs(params: {
  cadence: LoopCalendarCadence;
  dayOfWeek?: number;
  hour: number;
  minute: number;
  timezone: string;
  nowMs: number;
}) {
  const localNow = getLocalDateParts(params.nowMs, params.timezone);
  if (!localNow) {
    return undefined;
  }

  for (let offset = 0; offset < 14; offset += 1) {
    const candidateDate = addUtcDays(localNow.year, localNow.month, localNow.day, offset);
    if (!matchesCalendarCadence(params, candidateDate.dayOfWeek)) {
      continue;
    }
    const candidateMs = convertLocalDateTimeToUtcMs({
      year: candidateDate.year,
      month: candidateDate.month,
      day: candidateDate.day,
      hour: params.hour,
      minute: params.minute,
      timezone: params.timezone,
    });
    if (typeof candidateMs === "number" && candidateMs > params.nowMs) {
      return candidateMs;
    }
  }

  return undefined;
}

function parseWordDurationMs(value: number, rawUnit: string) {
  const unit = rawUnit.trim().toLowerCase();
  if (unit === "ms" || unit === "millisecond" || unit === "milliseconds") {
    return value;
  }
  if (unit === "s" || unit === "sec" || unit === "secs" || unit === "second" || unit === "seconds") {
    return value * 1000;
  }
  if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes") {
    return value * 60_000;
  }
  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
    return value * 60 * 60_000;
  }
  return null;
}

function parseLoopClockTime(raw: string) {
  const match = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return {
    hour,
    minute,
    localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function matchesCalendarCadence(
  params: {
    cadence: LoopCalendarCadence;
    dayOfWeek?: number;
  },
  dayOfWeek: number,
) {
  if (params.cadence === "daily") {
    return true;
  }
  if (params.cadence === "weekday") {
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
  return dayOfWeek === params.dayOfWeek;
}

function addUtcDays(year: number, month: number, day: number, offsetDays: number) {
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
  };
}

function getLocalDateParts(timestampMs: number, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestampMs));
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }
    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    const dayOfWeek = resolveLoopDayOfWeek(map.weekday ?? "");
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      dayOfWeek == null
    ) {
      return null;
    }
    return {
      year,
      month,
      day,
      hour,
      minute,
      dayOfWeek,
    };
  } catch {
    return null;
  }
}

function convertLocalDateTimeToUtcMs(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}) {
  const targetPseudoUtc = Date.UTC(
    params.year,
    params.month - 1,
    params.day,
    params.hour,
    params.minute,
  );
  let guessMs = targetPseudoUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getLocalDateParts(guessMs, params.timezone);
    if (!actual) {
      return null;
    }
    const actualPseudoUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const diffMs = targetPseudoUtc - actualPseudoUtc;
    if (diffMs === 0) {
      return guessMs;
    }
    guessMs += diffMs;
  }

  const final = getLocalDateParts(guessMs, params.timezone);
  if (
    final &&
    final.year === params.year &&
    final.month === params.month &&
    final.day === params.day &&
    final.hour === params.hour &&
    final.minute === params.minute
  ) {
    return guessMs;
  }

  return null;
}

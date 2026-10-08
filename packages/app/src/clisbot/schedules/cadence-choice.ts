/**
 * The schedule form stores every cadence as cron (`schedules/schedule-cadence-options.ts`); people
 * think in "every 15 minutes", "07:00 daily", "07:00 on Mondays". A choice is that second shape,
 * read from a cron expression and written back to one. Anything else stays Custom.
 */
export type CadenceMode = "every" | "daily" | "weekly" | "custom";
export type EveryUnit = "minutes" | "hours";

export interface CadenceChoice {
  mode: CadenceMode;
  amount: string;
  unit: EveryUnit;
  /** `HH:MM`, as typed. */
  time: string;
  /** Cron day numbers, 0 = Sunday. */
  days: number[];
  /** The expression itself, for Custom. */
  expression: string;
}

export type CadenceChoiceError = "amount" | "time" | "days" | null;

/**
 * Cron repeats evenly only when the step divides the hour or the day: a 15-hour step runs at
 * 00:00 and 15:00, not every 15 hours. So "every N" offers only those steps.
 */
export const EVERY_STEPS: Record<EveryUnit, readonly number[]> = {
  minutes: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30],
  hours: [1, 2, 3, 4, 6, 8, 12],
};

const DEFAULTS: Omit<CadenceChoice, "mode" | "expression"> = {
  amount: "15",
  unit: "minutes",
  time: "07:00",
  days: [1],
};

const INTEGER = /^\d+$/;

export function choiceFromCron(expression: string): CadenceChoice {
  const trimmed = expression.trim();
  const base = { ...DEFAULTS, expression: trimmed };
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return { ...base, mode: "custom" };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (dayOfMonth !== "*" || month !== "*") return { ...base, mode: "custom" };
  const every = everyFrom(minute, hour, dayOfWeek);
  if (every) return { ...base, mode: "every", ...every };
  if (!INTEGER.test(minute) || !INTEGER.test(hour)) return { ...base, mode: "custom" };
  const time = `${pad2(Number(hour))}:${pad2(Number(minute))}`;
  if (dayOfWeek === "*") return { ...base, mode: "daily", time };
  const days = parseDays(dayOfWeek);
  return days ? { ...base, mode: "weekly", time, days } : { ...base, mode: "custom" };
}

function everyFrom(
  minute: string,
  hour: string,
  dayOfWeek: string,
): Pick<CadenceChoice, "amount" | "unit"> | null {
  if (dayOfWeek !== "*") return null;
  if (hour === "*" && minute === "*") return { amount: "1", unit: "minutes" };
  if (hour === "*" && /^\*\/\d+$/.test(minute)) return { amount: minute.slice(2), unit: "minutes" };
  if (minute === "0" && hour === "*") return { amount: "1", unit: "hours" };
  if (minute === "0" && /^\*\/\d+$/.test(hour)) return { amount: hour.slice(2), unit: "hours" };
  return null;
}

/** `1`, `1,3,5`, `1-5`, `0,6`; 7 is Sunday too. Null for anything else. */
function parseDays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.add(day % 7);
    } else if (/^\d$/.test(part)) {
      days.add(Number(part) % 7);
    } else {
      return null;
    }
  }
  return [...days].sort((a, b) => a - b);
}

export function parseTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})(?:[:.h](\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export function choiceError(choice: CadenceChoice): CadenceChoiceError {
  if (choice.mode === "every") {
    const ok =
      INTEGER.test(choice.amount) && EVERY_STEPS[choice.unit].includes(Number(choice.amount));
    return ok ? null : "amount";
  }
  if (choice.mode === "custom") return null;
  if (!parseTime(choice.time)) return "time";
  return choice.mode === "weekly" && choice.days.length === 0 ? "days" : null;
}

/** The cron a choice stands for, or null while it is incomplete. */
export function cronFromChoice(choice: CadenceChoice): string | null {
  if (choice.mode === "custom") return choice.expression.trim();
  if (choiceError(choice)) return null;
  if (choice.mode === "every") {
    const amount = Number(choice.amount);
    if (choice.unit === "minutes") return amount === 1 ? "* * * * *" : `*/${amount} * * * *`;
    return amount === 1 ? "0 * * * *" : `0 */${amount} * * *`;
  }
  const { hour, minute } = parseTime(choice.time)!;
  return `${minute} ${hour} * * ${choice.mode === "daily" ? "*" : daysField(choice.days)}`;
}

function daysField(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.join(",") === "1,2,3,4,5" ? "1-5" : sorted.join(",");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** One-press picks for the cadences people ask for most. */
export const QUICK_PICKS = [
  { key: "every5", expression: "*/5 * * * *" },
  { key: "every15", expression: "*/15 * * * *" },
  { key: "hourly", expression: "0 * * * *" },
  { key: "daily7", expression: "0 7 * * *" },
  { key: "weekdays9", expression: "0 9 * * 1-5" },
  { key: "monday7", expression: "0 7 * * 1" },
] as const;

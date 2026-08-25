const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const ABSOLUTE_TIME = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

/**
 * A timestamp that reads "3m ago" at a glance, with the absolute value one hover
 * away in the native `title` tooltip. The one place a row shows time, so a table
 * scan never forces the reader to do date arithmetic in their head.
 */
export function RelativeTime({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} title={ABSOLUTE_TIME.format(date)}>
      {relativeLabel(date)}
    </time>
  );
}

function relativeLabel(date: Date): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, unitSeconds] of UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return RELATIVE_TIME.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return RELATIVE_TIME.format(Math.round(seconds / 60), "minute");
}

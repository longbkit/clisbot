/** A Hub enum value shown as a label: `member` → `Member`, `owner` → `Owner`. */
export function capitalizeLabel(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

/** `count` with the word that agrees with it: `plural(1, "Team")` → `Team`. */
export function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

/** `3 Teams`, `1 Team`. */
export function countLabel(count: number, singular: string, pluralValue?: string): string {
  return `${String(count)} ${plural(count, singular, pluralValue)}`;
}

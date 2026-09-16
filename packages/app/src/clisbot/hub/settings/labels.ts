/** A Hub enum value shown as a label: `member` → `Member`, `owner` → `Owner`. */
export function capitalizeLabel(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

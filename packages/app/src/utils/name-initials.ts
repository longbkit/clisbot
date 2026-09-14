/**
 * Two-letter monogram: first letters of the first and last word, upper-cased.
 * `fallback` supplies the letter when the name is empty (typically the first
 * character of an email); "?" is the last resort.
 */
export function nameInitials(name: string, fallback?: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words.at(0)?.at(0) ?? fallback?.at(0) ?? "?";
  const last = words.length > 1 ? (words.at(-1)?.at(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

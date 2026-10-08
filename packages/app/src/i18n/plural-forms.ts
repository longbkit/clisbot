/**
 * Resource files keep the same keys in every locale, so plurals carry only `_one` and
 * `_other`. Arabic and Russian select more forms (`Intl.PluralRules`): without them i18next
 * misses the key for counts like 3 or 5 and shows English. Their `_other` strings are worded
 * to read for any count, so the missing forms reuse `_other` at load time.
 */
const EXTRA_PLURAL_FORMS: Record<string, readonly string[]> = {
  ar: ["zero", "two", "few", "many"],
  ru: ["few", "many"],
};

export function withPluralForms<T extends object>(locale: string, resource: T): T {
  const forms = EXTRA_PLURAL_FORMS[locale];
  return forms ? (fill(resource, forms) as T) : resource;
}

function fill(value: unknown, forms: readonly string[]): unknown {
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) result[key] = fill(child, forms);
  for (const [key, child] of Object.entries(value)) {
    if (!key.endsWith("_other") || typeof child !== "string") continue;
    const base = key.slice(0, -"_other".length);
    for (const form of forms) result[`${base}_${form}`] ??= child;
  }
  return result;
}

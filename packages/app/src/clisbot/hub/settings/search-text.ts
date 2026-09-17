/**
 * Folds text for search: lower case, no diacritics, so `nguyen` finds `Nguyễn` and `đ` finds `d`.
 */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .trim();
}

/** Whether every word of `query` appears in one of `fields`. An empty query matches everything. */
export function matchesSearch(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const words = foldSearchText(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.flatMap((field) => (field ? [foldSearchText(field)] : [])).join("\n");
  return words.every((word) => haystack.includes(word));
}

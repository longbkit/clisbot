import { slugify } from "@getpaseo/protocol/branch-slug";
import { isRoomWideMention } from "@getpaseo/protocol/chats/mentions";

/**
 * The bot directory name (docs/features/bots-and-chats/README.md, D3): derived from
 * the display name once, unique per Host, never changed afterwards.
 */
const FALLBACK_SLUG = "bot";

/** Lowercase, non-alphanumerics to `-`, trimmed, at most 50 characters; `bot` when nothing is left. */
export function botSlug(name: string): string {
  return slugify(name) || FALLBACK_SLUG;
}

/**
 * The first of `slug`, `slug-2`, `slug-3`, … that is neither a recorded bot slug nor an
 * existing entry under the root. Archived bots keep their slug: the directory still exists.
 */
export async function uniqueBotSlug(
  name: string,
  taken: ReadonlySet<string>,
  directoryExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = botSlug(name);
  // `@everyone`, `@all` and `@here` address the whole room, so no bot may take them.
  for (let suffix = isRoomWideMention(base) ? 2 : 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.has(candidate) && !(await directoryExists(candidate))) return candidate;
  }
}

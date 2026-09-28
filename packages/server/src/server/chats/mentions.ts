// Who a chat message names (docs/features/bots-and-chats/plans/group-discussion.md). The
// grammar lives in the protocol so the app's picker and chips read mentions the same way.
// Users write `@slug` from the picker; models write the names they read in the roster, so a
// bot's line may also name a participant as `@Display Name`. An `@x` that names no
// participant is plain text.
import { isRoomWideMention, mentionTokens } from "@getpaseo/protocol/chats/mentions";

export interface MentionableParticipant {
  botId: string;
  slug: string;
  /** Matched after `@` only when `displayNames` is on. */
  displayName?: string;
}

export interface ParsedMentions {
  /** Bot ids, in order of first appearance, each once. */
  botIds: string[];
  /** `@everyone`, `@all` or `@here` appeared. */
  room: boolean;
}

/** Bot ids mentioned in `text` by slug, in order of first appearance, each once. */
export function parseMentions(
  text: string,
  participants: readonly MentionableParticipant[],
): string[] {
  return parseMessageMentions(text, participants).botIds;
}

export function parseMessageMentions(
  text: string,
  participants: readonly MentionableParticipant[],
  options: { displayNames?: boolean } = {},
): ParsedMentions {
  const bySlug = new Map(participants.map((entry) => [entry.slug.toLowerCase(), entry.botId]));
  const found: { at: number; botId: string }[] = [];
  let room = false;
  for (const mention of mentionTokens(text)) {
    if (isRoomWideMention(mention.token)) room = true;
    const botId = bySlug.get(mention.token.toLowerCase());
    if (botId) found.push({ at: mention.start, botId });
  }
  if (options.displayNames) found.push(...displayNameMentions(text, participants));
  found.sort((left, right) => left.at - right.at);
  return { botIds: [...new Set(found.map((entry) => entry.botId))], room };
}

function displayNameMentions(
  text: string,
  participants: readonly MentionableParticipant[],
): { at: number; botId: string }[] {
  const lower = text.toLowerCase();
  const found: { at: number; botId: string }[] = [];
  for (const { botId, displayName } of participants) {
    if (!displayName) continue;
    const needle = `@${displayName.toLowerCase()}`;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
      if (!continuesWord(lower[at + needle.length])) found.push({ at, botId });
    }
  }
  return found;
}

function continuesWord(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_-]/u.test(char);
}

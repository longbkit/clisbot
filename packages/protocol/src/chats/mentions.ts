// The chat mention grammar, shared by the daemon (who wakes) and the app (the `@` picker and
// mention chips): `@<slug>` names one bot, `@everyone` (aliases `@all`, `@here`) the whole room
// (docs/features/bots-and-chats/plans/group-discussion.md). Pure.

/** The room-wide mentions; the first is the one the app inserts. A bot slug never takes one. */
export const ROOM_WIDE_MENTIONS = ["everyone", "all", "here"] as const;

export interface MentionToken {
  /** The text after `@`, as written. */
  token: string;
  /** Index of the `@`. */
  start: number;
  /** Index just past the token. */
  end: number;
}

/** A slug token: what a bot slug looks like, so a mention never spans into punctuation. */
const MENTION_PATTERN = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}][\p{L}\p{N}-]*)/gu;

/** Every `@token` in `text`, in order. Whether it names anyone is the caller's question. */
export function mentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index + match[1]!.length;
    tokens.push({ token: match[2]!, start, end: start + 1 + match[2]!.length });
  }
  return tokens;
}

export function isRoomWideMention(token: string): boolean {
  return (ROOM_WIDE_MENTIONS as readonly string[]).includes(token.toLowerCase());
}

/** Whether `text` addresses the whole room. */
export function mentionsRoom(text: string): boolean {
  return mentionTokens(text).some((mention) => isRoomWideMention(mention.token));
}

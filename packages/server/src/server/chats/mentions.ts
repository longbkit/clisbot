// `@slug` mentions in a chat message, matched against the participants' slugs
// (docs/features/bots-and-chats/plans/server-chat.md, §2.2). The app inserts the
// slug from a picker; display names are never matched (spaces, renames) and an
// `@x` that names no participant is plain text.

/** A slug token: what `botSlug` produces, so a mention never spans into punctuation. */
const MENTION_PATTERN = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}][\p{L}\p{N}-]*)/gu;

export interface MentionableParticipant {
  botId: string;
  slug: string;
}

/** Bot ids mentioned in `text`, in order of first appearance, each once. */
export function parseMentions(
  text: string,
  participants: readonly MentionableParticipant[],
): string[] {
  const bySlug = new Map(
    participants.map((participant) => [participant.slug.toLowerCase(), participant.botId]),
  );
  const mentioned: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const botId = bySlug.get(match[2]!.toLowerCase());
    if (botId && !mentioned.includes(botId)) mentioned.push(botId);
  }
  return mentioned;
}

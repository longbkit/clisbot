// The `@` picker's member entries in a group chat composer
// (docs/features/bots-and-chats/plans/group-discussion.md, "Tagging from the app"): Everyone
// first, then the members in Members order, then the ordinary file suggestions. Picking one
// inserts `@slug`, the token the daemon reads. Pure.
import {
  isRoomWideMention,
  mentionTokens,
  ROOM_WIDE_MENTIONS,
} from "@clisbot/protocol/chats/mentions";
import { i18n } from "@/i18n/i18next";

export interface MentionMember {
  slug: string;
  displayName: string;
}

export interface MemberMentionOption {
  type: "chat_member";
  id: string;
  label: string;
  description: string;
  /** What replaces the typed `@query`, without the `@`. */
  token: string;
}

const EVERYONE = ROOM_WIDE_MENTIONS[0];

/** The participants that `@slug` can name, from the chat's bot identities. */
export function mentionMembersOf(bots: Iterable<{ slug?: string; name: string }>): MentionMember[] {
  return [...bots].flatMap((bot) => (bot.slug ? [{ slug: bot.slug, displayName: bot.name }] : []));
}

/** Entries whose token or name contains `query`; Everyone only in a group of two or more. */
export function memberMentionOptions(
  members: readonly MentionMember[],
  query: string,
): MemberMentionOption[] {
  const needle = query.trim().toLowerCase();
  const matches = (value: string) => needle === "" || value.toLowerCase().includes(needle);
  const everyone: MemberMentionOption[] =
    members.length > 1 && matches(EVERYONE)
      ? [
          {
            type: "chat_member",
            id: `member:${EVERYONE}`,
            label: `@${EVERYONE}`,
            description: i18n.t("bots.chat.mentions.everyone"),
            token: EVERYONE,
          },
        ]
      : [];
  return [
    ...everyone,
    ...members
      .filter((member) => matches(member.slug) || matches(member.displayName))
      .map((member) => ({
        type: "chat_member" as const,
        id: `member:${member.slug}`,
        label: member.displayName,
        description: `@${member.slug}`,
        token: member.slug,
      })),
  ];
}

/** Replaces the typed `@query` between `start` and `end` with `@token` and a space. */
export function applyMemberMention(
  text: string,
  range: { start: number; end: number },
  token: string,
): string {
  const after = text.slice(range.end);
  return `${text.slice(0, range.start)}@${token}${after.startsWith(" ") ? "" : " "}${after}`;
}

/**
 * How a transcript line shows its mentions: a participant's `@slug` reads as `@Display Name`
 * and the room-wide token as `@everyone`, bold in markdown. Unknown `@x` stays as written.
 */
export function displayMentions(
  text: string,
  members: readonly MentionMember[],
  options: { markdown: boolean },
): string {
  const bySlug = new Map(members.map((member) => [member.slug.toLowerCase(), member]));
  let result = "";
  let cursor = 0;
  for (const mention of mentionTokens(text)) {
    const shown = shownMention(mention.token, bySlug);
    if (!shown) continue;
    result += text.slice(cursor, mention.start) + (options.markdown ? `**${shown}**` : shown);
    cursor = mention.end;
  }
  return result + text.slice(cursor);
}

function shownMention(token: string, bySlug: ReadonlyMap<string, MentionMember>): string | null {
  const member = bySlug.get(token.toLowerCase());
  if (member) return `@${member.displayName}`;
  return isRoomWideMention(token) ? `@${EVERYONE}` : null;
}

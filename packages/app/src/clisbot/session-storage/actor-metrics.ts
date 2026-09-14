/**
 * Shared geometry for the actor gutter in a chat row. The avatar column, the
 * sender name row, and the gap under the name all have to agree: the face is
 * pushed down by exactly the name row so it top-aligns with the content below
 * the name — the bubble for a person, the first text block for the agent — and
 * not with the name itself.
 */
export const ACTOR_AVATAR_SIZE = 32;

/** Inline avatars (sidebar metadata, permission rows) that share a text line. */
export const ACTOR_INLINE_AVATAR_SIZE = 16;

/** The name line box. Tight enough that the bubble reads as the same group. */
export const ACTOR_NAME_ROW_HEIGHT = 16;

/** Space between the sender name and the first bubble or tool row. */
export const ACTOR_NAME_CONTENT_GAP = 2;

/** Space between the face gutter and the content column. */
export const ACTOR_GUTTER_GAP = 8;

/** How far content sits from the row's edge once the gutter takes its place. */
export const ACTOR_CONTENT_INSET = ACTOR_AVATAR_SIZE + ACTOR_GUTTER_GAP;

/** How far the name line pushes the content — and so the face — down. */
export const ACTOR_NAME_ROW_OFFSET = ACTOR_NAME_ROW_HEIGHT + ACTOR_NAME_CONTENT_GAP;

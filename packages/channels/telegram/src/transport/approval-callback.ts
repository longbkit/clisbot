// L2 — the approval card's button-click envelope for the Telegram vertical
// (COMPAT(clisbot-control-plane), the E2 half of the Slack `block_actions`
// seam). The Bot API `callback_query` update (docs.telegram.org Bot API
// "callback_query") narrowed to the control plane's approval card: the
// vertical parses the CHANNEL envelope only (who clicked, where the card
// sits, which chat kind); the card VALUE (`callback_data`) stays opaque and
// is parsed once in the hub (its card-value scheme owns the format).
//
// Wire facts: `from` (the clicker), `data` (the opaque value), and `message`
// (the message the button sits in — chat + message id + optional
// `message_thread_id`) all sit at the update's top level, no nesting. The
// root conversation is `message.chat.id`; a topic click rides on
// `message.message_thread_id` (forum groups), absent at the chat root.

/** The `callback_query` facts the approval half reads (Bot API subset). */
export interface TelegramCallbackQueryShape {
  /** The callback query id (the `answerCallbackQuery` target). */
  id: string;
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
  /** The message the click was in (absent for channel posts the bot cannot
   * see — a card click on our own posted message always carries it). */
  message?: {
    message_id?: number;
    chat?: {
      id: number;
      type?: string;
      title?: string;
      username?: string;
    };
    message_thread_id?: number;
  };
  chat_instance?: string;
  /** The opaque card value (hub card-value scheme). */
  data?: string;
}

/** One approval-card button click, parsed from the `callback_query` update.
 * The hub's approval seam receives these facts verbatim (the card value
 * opaque, the identities pre-normalized to the plane's vocabulary). */
export interface ApprovalCallbackClick {
  /** The clicker's native user id (no `telegram:` prefix: the caller applies
   * the plane's `<channel>:<id>` identity). */
  senderId: string;
  /** The clicked button's opaque card value (hub card-value scheme). */
  cardValue: string;
  /** The ROOT conversation id (`message.chat.id` — a card in a topic reports
   * the group, the topic riding on `threadId`). */
  rootChatId: string;
  /** The card's topic id when the card was posted in a forum topic; absent
   * at the chat root. */
  threadId?: string | undefined;
  /** The chat's native type (`private` / `group` / `supergroup` /
   * `channel`) — the root-kind normalization input. */
  chatType?: string | undefined;
  /** The card's own message id (the in-place-update target — the mirror of
   * the Slack half's `messageTs`). */
  messageId?: string | undefined;
}

/**
 * Narrow a raw `callback_query` update to the approval card's click. Null for
 * anything unactionable: no clicker, no opaque value (an empty `data` is an
 * inert click, not a card), or no host message/chat (a card click on our own
 * posted message always carries `message.chat`). Does NOT parse `data`: the
 * hub's card-value parse + open-prompt lookup is the card-ownership test (a
 * value this card did not mint fails closed there).
 */
export function parseApprovalCallbackClick(
  callbackQuery: TelegramCallbackQueryShape,
): ApprovalCallbackClick | null {
  const from = callbackQuery.from;
  if (from === undefined || typeof from.id !== "number") return null;
  const cardValue = callbackQuery.data;
  if (typeof cardValue !== "string" || cardValue === "") return null;
  const chat = callbackQuery.message?.chat;
  if (chat === undefined || typeof chat.id !== "number") return null;
  const threadId = callbackQuery.message?.message_thread_id;
  const messageId = callbackQuery.message?.message_id;
  return {
    senderId: String(from.id),
    cardValue,
    rootChatId: String(chat.id),
    ...(threadId !== undefined && threadId !== 0 ? { threadId: String(threadId) } : {}),
    ...(chat.type !== undefined ? { chatType: chat.type } : {}),
    ...(messageId !== undefined ? { messageId: String(messageId) } : {}),
  };
}

/**
 * The plane's root-conversation kind of a Telegram chat (the vertical's
 * normalization for the hub's approval seam, matching the inbound path's
 * native → plane table): `private` → `dm`, anything else (`group` /
 * `supergroup` / `channel`, incl. unknown) → `group` (the plane has no
 * distinct Telegram "channel" kind — channel posts never host a card click
 * the vertical can attribute).
 */
export function approvalCallbackRootKind(chatType?: string): "dm" | "group" {
  return chatType === "private" ? "dm" : "group";
}

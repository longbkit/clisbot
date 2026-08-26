// L1 string/number coercion leaf — the pinned chunk's target parsing +
// error-wrapping helpers (SYNC.md). Pure functions, no imports.

/** One-line string for `err` in log lines / thrown messages. */
export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause;
    const causeText =
      cause instanceof Error || (typeof cause === "object" && cause !== null && "message" in cause)
        ? `: ${formatErrorMessage(cause)}`
        : "";
    return err.message + causeText;
  }
  return String(err);
}

/** Trim + reject empty; `undefined` passes through as `undefined`. */
export function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Strict integer parse: optional leading `-`, digits only, safe range,
 * non-zero. Returns `undefined` for anything else (incl. `""`, `"1.5"`,
 * `"0"`). Negative values pass through — supergroup chat ids are negative. */
export function normalizeStrictInteger(value: string | number): number | undefined {
  const raw = typeof value === "number" ? String(value) : String(value).trim();
  if (raw === "" || !/^-?\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed === 0) return undefined;
  return parsed;
}

export interface ParsedTelegramTarget {
  chatId: string;
  messageThreadId: number | null;
  chatType: "direct" | "group";
}

/** Parse an outbound `to` value: `<chatId>` or `@username`, optional
 * `:topic:<id>` suffix (Telegram forum topic). Telegram chat ids may be
 * negative (supergroups); the `:topic:` split happens on the first colon
 * AFTER the chat id, so `@user:topic:42` parses too. */
export function parseTelegramTarget(raw: string): ParsedTelegramTarget {
  const trimmed = raw.trim();
  if (trimmed === "") throw new Error("Telegram target must be non-empty");
  let chatId = trimmed;
  let messageThreadId: number | null = null;
  const topic = /:(topic:)?(-?\d+)$/.exec(trimmed);
  if (topic !== null) {
    const match = topic;
    chatId = trimmed.slice(0, match.index);
    const idText = match[2];
    if (idText === undefined) throw new Error(`invalid Telegram topic target "${raw}"`);
    const parsed = Number(idText);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid Telegram topic id in "${raw}"`);
    }
    messageThreadId = parsed;
  }
  if (chatId === "") throw new Error(`invalid Telegram target "${raw}"`);
  // Telegram direct chat ids are positive; groups/supergroups are negative.
  const chatType: ParsedTelegramTarget["chatType"] = chatId.startsWith("-") ? "group" : "direct";
  return { chatId, messageThreadId, chatType };
}

/** Wrap a 4xx chat-not-found / not-a-member send failure with the pinned
 * fix-it message (the recipient must allow the bot first). */
export function wrapTelegramChatNotFoundError(
  err: unknown,
  params: { chatId: string; input: string },
): unknown {
  const fields: { status?: number; description?: string } = {};
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    if (typeof record["status"] === "number") fields.status = record["status"];
    else if (typeof record["statusCode"] === "number") fields.status = record["statusCode"];
    if (typeof record["description"] === "string") fields.description = record["description"];
    else if (typeof record["message"] === "string") fields.description = record["message"];
  }
  const status = fields.status;
  const description = fields.description ?? "";
  const notFound =
    status === 400 ||
    status === 403 ||
    /chat not found|group chat was deactivated|not a member|forbidden: bot/i.test(description);
  if (!notFound) return err;
  const message =
    `Telegram send to "${params.input}" failed (chat ${params.chatId}): ${description || "bot cannot see this chat"}. ` +
    "The bot must be added to the group (or the user must have messaged it first for a direct chat) and the bot's privacy mode must allow it to read messages.";
  return new Error(message, { cause: err });
}

// Differential corpus inputs for the Telegram pure functions ported verbatim.
//
// Every case names the upstream test file its input came from. Inputs are
// harvested from upstream; outputs are recorded from the local functions into
// `upstream-differential.json` by `scripts/channel-differential-fixtures.mjs`
// and replayed by `upstream-differential.test.ts`.
//
// Add a case when a ported pure function gains upstream coverage; never edit
// the JSON by hand.
import type { DifferentialCase } from "@getpaseo/channels-shared";
import type { Message } from "grammy/types";
import { hasBotMention, hasBotMentionInText } from "../bot/body-helpers.js";
import {
  countTelegramHtmlVisibleCharacters,
  escapeTelegramHtml,
  markdownToTelegramHtml,
  markdownToTelegramHtmlChunks,
  splitTelegramHtmlChunks,
  telegramHtmlToPlainTextFallback,
} from "../format.js";
import {
  isRecoverableTelegramNetworkError,
  isRetryableTelegramApiError,
  isSafeToRetrySendError,
  isTelegramAuthenticationError,
  isTelegramBadRequestError,
  isTelegramEditTargetMissingError,
  isTelegramMessageNotModifiedError,
  isTelegramRateLimitError,
  isTelegramServerError,
  readTelegramRetryAfterMs,
  shouldRetryTelegramSendError,
} from "../network-errors.js";
import { splitTelegramPlainTextChunks } from "../rich-plain-fallback.js";
import {
  isTelegramCaptionTooLongError,
  isTelegramPhotoLimitError,
  isTelegramVoiceMessagesForbiddenError,
} from "../send-error-predicates.js";
import {
  isNumericTelegramChatId,
  normalizeTelegramChatId,
  normalizeTelegramLookupTarget,
  normalizeTelegramOutboundTarget,
  parseTelegramTarget,
  resolveTelegramTargetChatType,
  stripTelegramInternalPrefixes,
} from "../targets.js";
import { resolveTelegramTextChunkLimit } from "../text-chunk-limit.js";

const FORMAT_TEST = "extensions/telegram/src/format.test.ts";
const WRAP_MD_TEST = "extensions/telegram/src/format.wrap-md.test.ts";
const PLAIN_CHUNKS_TEST = "extensions/telegram/src/send.chunks.test.ts";
const OUTBOUND_TEST = "extensions/telegram/src/telegram-outbound.test.ts";
const HELPERS_TEST = "extensions/telegram/src/bot/helpers.test.ts";
const REQUIRE_MENTION_TEST = "extensions/telegram/src/bot-message-context.require-mention.test.ts";
const TARGETS_TEST = "extensions/telegram/src/targets.test.ts";
const RESOLVE_TARGETS_TEST = "extensions/telegram/src/channel.resolve-targets.test.ts";
const SEND_MUTATION_TARGETS_TEST = "extensions/telegram/src/send-mutation-targets.test.ts";
const NETWORK_ERRORS_TEST = "extensions/telegram/src/network-errors.test.ts";
const DELIVERY_TRACE_TEST = "extensions/telegram/src/delivery-trace.test.ts";
const DRAFT_STREAM_TEST = "extensions/telegram/src/draft-stream.test.ts";
const DELIVERY_TEST = "extensions/telegram/src/bot/delivery.test.ts";

// --------------------------------------------------------------- formatting

/** Markdown → Telegram HTML inputs upstream asserts case by case. */
const MARKDOWN_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly markdown: string;
  readonly upstreamTestFile: string;
  readonly options?: { tableMode?: "code"; wrapFileRefs?: boolean };
}> = [
  {
    id: "role-header-bold",
    markdown: "**user**[Thu 2026-07-02] question",
    upstreamTestFile: FORMAT_TEST,
  },
  {
    id: "role-header-promoted-html",
    markdown: "<b>user[Thu 2026-07-02]</b> authorize",
    upstreamTestFile: FORMAT_TEST,
  },
  {
    id: "inline-formatting",
    markdown: "hi _there_ **boss** `code`",
    upstreamTestFile: FORMAT_TEST,
  },
  { id: "link", markdown: "see [docs](https://example.com)", upstreamTestFile: FORMAT_TEST },
  {
    id: "tg-time-unix-attribute",
    markdown: '<tg-time unix="1647531900" format="wDT">22:45 tomorrow</tg-time>',
    upstreamTestFile: FORMAT_TEST,
  },
  { id: "script-tag", markdown: "<script>nope</script>", upstreamTestFile: FORMAT_TEST },
  { id: "inline-code-with-html", markdown: "`<b>literal</b>`", upstreamTestFile: FORMAT_TEST },
  {
    id: "fenced-code-with-html",
    markdown: "```\n<blockquote>literal</blockquote>\n```",
    upstreamTestFile: FORMAT_TEST,
  },
  {
    id: "unsupported-bold-attribute",
    markdown: '<b class="x">bad</b>',
    upstreamTestFile: FORMAT_TEST,
  },
  {
    id: "expandable-blockquote",
    markdown: "<blockquote expandable>hidden details</blockquote>",
    upstreamTestFile: FORMAT_TEST,
  },
  { id: "fenced-language", markdown: '```bash\necho "hello"\n```', upstreamTestFile: FORMAT_TEST },
  {
    id: "bold-overlapping-autolink",
    markdown: "**start https://example.com** end",
    upstreamTestFile: FORMAT_TEST,
  },
  {
    id: "link-inside-bold",
    markdown: "**bold [link](https://example.com) text**",
    upstreamTestFile: FORMAT_TEST,
  },
  { id: "spoiler", markdown: "the answer is ||42||", upstreamTestFile: FORMAT_TEST },
  {
    id: "markdown-table-code-mode",
    markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
    upstreamTestFile: FORMAT_TEST,
    options: { tableMode: "code" },
  },
  {
    id: "file-ref-beside-authored-link",
    markdown: "README.md [README.md](https://README.md)",
    upstreamTestFile: WRAP_MD_TEST,
  },
  {
    id: "domain-tlds-stay-links",
    markdown: "Check x.ai and vercel.io and app.tv and radio.fm",
    upstreamTestFile: WRAP_MD_TEST,
  },
  {
    id: "wrap-file-refs-disabled",
    markdown: "Check README.md",
    upstreamTestFile: WRAP_MD_TEST,
    options: { wrapFileRefs: false },
  },
];

/** Fallback-text inputs: the HTML shapes upstream renders back to plain text. */
const PLAIN_TEXT_FALLBACK_INPUTS: ReadonlyArray<{ readonly id: string; readonly html: string }> = [
  {
    id: "anchors-code-and-breaks",
    html: [
      'Created: <a href="https://example.com/a?x=1&amp;y=2">Task &amp; One</a>',
      "<code>file.md</code>",
      "<br>",
      '<a href="https://example.com/same">https://example.com/same</a>',
      "<b>done</b>",
    ].join(" "),
  },
  {
    id: "escaped-angle-label",
    html: '<a href="https://example.com/task?id=1&amp;kind=bug">Task &lt;id&gt;</a>',
  },
  {
    id: "table-cell-boundaries",
    html: "<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>",
  },
  {
    id: "colspan-unquoted-decimal",
    html: "<table><tr><td colspan=2>Alice</td><td>30</td></tr></table>",
  },
  { id: "hex-high-surrogate-entity", html: "x &#xD800; y" },
  { id: "astral-numeric-entities", html: "x &#x1F600; &#128512; y" },
];

/** Escaping and visible-length inputs reused from the same upstream HTML shapes. */
const ESCAPE_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["unsafe-characters", "a & b < c"],
  ["telegram-html", "<b>yes</b>"],
  ["empty", ""],
];

const VISIBLE_LENGTH_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["bold-tag", "<b>done</b>"],
  ["entity-decoded", "Task &amp; One"],
  ["astral-entity", "x &#x1F600; y"],
];

const formattingCases: DifferentialCase[] = [
  ...MARKDOWN_INPUTS.map(({ id, markdown, upstreamTestFile, options }) => ({
    id: `markdownToTelegramHtml/${id}`,
    upstreamTestFile,
    fn: "src/format.ts#markdownToTelegramHtml",
    input: options ? { markdown, options } : { markdown },
    run: () =>
      options ? markdownToTelegramHtml(markdown, options) : markdownToTelegramHtml(markdown),
  })),
  ...PLAIN_TEXT_FALLBACK_INPUTS.map(({ id, html }) => ({
    id: `telegramHtmlToPlainTextFallback/${id}`,
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#telegramHtmlToPlainTextFallback",
    input: { html },
    run: () => telegramHtmlToPlainTextFallback(html),
  })),
  ...ESCAPE_INPUTS.map(([id, text]) => ({
    id: `escapeTelegramHtml/${id}`,
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#escapeTelegramHtml",
    input: { text },
    run: () => escapeTelegramHtml(text),
  })),
  ...VISIBLE_LENGTH_INPUTS.map(([id, html]) => ({
    id: `countTelegramHtmlVisibleCharacters/${id}`,
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#countTelegramHtmlVisibleCharacters",
    input: { html },
    run: () => countTelegramHtmlVisibleCharacters(html),
  })),
];

// ----------------------------------------------------------------- chunking

/** Chunker inputs are generated, so the corpus stores the recipe, not 4 KB of A. */
const HTML_CHUNK_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly html: string;
  readonly limit: number;
}> = [
  { id: "balanced-bold-across-chunks", html: `<b>${"A\n".repeat(2_500)}</b>`, limit: 4_000 },
  {
    id: "role-header-in-final-chunk",
    html: `${"x".repeat(4_000)}\n<b>user[Thu 2026-07-02]</b> authorize`,
    limit: 4_000,
  },
  { id: "leading-entity-cannot-fit", html: `A&amp;${"B".repeat(20)}`, limit: 4 },
  { id: "malformed-leading-ampersand", html: `&${"A".repeat(5_000)}`, limit: 4_000 },
  { id: "hard-cut-single-word", html: "A".repeat(30), limit: 10 },
  { id: "tag-overhead-fills-chunk", html: "<b><i><u>x</u></i></b>", limit: 10 },
  {
    id: "oversized-tag-scope-dropped",
    html: `<a href="https://example.com/${"x".repeat(40)}">first</a><b>second</b>`,
    limit: 20,
  },
  { id: "astral-straddles-boundary", html: `${"A".repeat(9)}😀${"B".repeat(20)}`, limit: 10 },
];

/** Markdown chunker inputs: the html-limit retry paths upstream pins. */
const MARKDOWN_CHUNK_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly markdown: string;
  readonly limit: number;
}> = [
  { id: "whitespace-preserved-on-retry", markdown: "a < b", limit: 5 },
  { id: "formatted-prose-word-boundary", markdown: "**Which of these**", limit: 16 },
  { id: "formatting-preserved-at-boundary", markdown: "**alpha <<**", limit: 13 },
  { id: "sliced-file-ref", markdown: "README.md<", limit: 22 },
  { id: "tag-overhead-exceeds-limit", markdown: "**ab**", limit: 6 },
  { id: "unbalanced-parenthesis", markdown: "**foo (bar baz qux quux**", limit: 20 },
  { id: "single-word-hard-split", markdown: "supercalifragilistic", limit: 8 },
];

/** Plain-text chunker inputs: the surrogate-pair stall regressions. */
const PLAIN_CHUNK_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
  readonly limit: number;
}> = [
  { id: "astral-straddles-boundary", text: `${"A".repeat(9)}😀${"B".repeat(20)}`, limit: 10 },
  { id: "astral-first-at-limit-one", text: "😀X", limit: 1 },
  { id: "astral-mid-string-at-limit-one", text: "A😀B", limit: 1 },
];

/** Chunk-limit resolution: upstream drives it through the outbound adapter. */
const CHUNK_LIMIT_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly params: {
    cfg: unknown;
    accountId?: string;
    formatting?: { parseMode: "HTML" };
  };
}> = [
  { id: "empty-config", params: { cfg: {}, accountId: "default" } },
  {
    id: "rich-messages-enabled",
    params: { cfg: { channels: { telegram: { richMessages: true } } }, accountId: "default" },
  },
  {
    id: "rich-messages-with-lower-limit",
    params: {
      cfg: { channels: { telegram: { richMessages: true, textChunkLimit: 1200 } } },
      accountId: "default",
    },
  },
  {
    id: "rich-messages-legacy-html",
    params: {
      cfg: { channels: { telegram: { richMessages: true } } },
      accountId: "default",
      formatting: { parseMode: "HTML" },
    },
  },
  {
    id: "account-scoped-rich-messages",
    params: {
      cfg: {
        channels: { telegram: { richMessages: false, accounts: { rich: { richMessages: true } } } },
      },
      accountId: "rich",
    },
  },
  {
    id: "account-scoped-lower-limit",
    params: {
      cfg: {
        channels: {
          telegram: { accounts: { rich: { richMessages: true, textChunkLimit: 1200 } } },
        },
      },
      accountId: "rich",
    },
  },
];

const chunkingCases: DifferentialCase[] = [
  ...HTML_CHUNK_INPUTS.map(({ id, html, limit }) => ({
    id: `splitTelegramHtmlChunks/${id}`,
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#splitTelegramHtmlChunks",
    // The html is summarized: a 4 KB literal in the fixture would bury the diff.
    input: { htmlLength: html.length, htmlHead: html.slice(0, 40), limit },
    run: () => splitTelegramHtmlChunks(html, limit),
  })),
  ...MARKDOWN_CHUNK_INPUTS.map(({ id, markdown, limit }) => ({
    id: `markdownToTelegramHtmlChunks/${id}`,
    upstreamTestFile: WRAP_MD_TEST,
    fn: "src/format.ts#markdownToTelegramHtmlChunks",
    input: { markdownLength: markdown.length, markdownHead: markdown.slice(0, 40), limit },
    run: () => markdownToTelegramHtmlChunks(markdown, limit),
  })),
  ...PLAIN_CHUNK_INPUTS.map(({ id, text, limit }) => ({
    id: `splitTelegramPlainTextChunks/${id}`,
    upstreamTestFile: PLAIN_CHUNKS_TEST,
    fn: "src/rich-plain-fallback.ts#splitTelegramPlainTextChunks",
    input: { textLength: text.length, textHead: text.slice(0, 40), limit },
    run: () => splitTelegramPlainTextChunks(text, limit),
  })),
  ...CHUNK_LIMIT_INPUTS.map(({ id, params }) => ({
    id: `resolveTelegramTextChunkLimit/${id}`,
    upstreamTestFile: OUTBOUND_TEST,
    fn: "src/text-chunk-limit.ts#resolveTelegramTextChunkLimit",
    input: params,
    run: () =>
      resolveTelegramTextChunkLimit(
        params as unknown as Parameters<typeof resolveTelegramTextChunkLimit>[0],
      ),
  })),
];

// ----------------------------------------------------------------- mentions

/** `hasBotMention` reads only text/entities, so the message literal stays small. */
const BOT_MENTION_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly message: Record<string, unknown>;
  readonly botUsername: string;
}> = [
  {
    id: "exact-plain-text-mention",
    message: { text: "@gaian what is the group id?", chat: { id: 1, type: "supergroup" } },
    botUsername: "gaian",
  },
  {
    id: "longer-username-prefix",
    message: { text: "@GaianChat_Bot what is the group id?", chat: { id: 1, type: "supergroup" } },
    botUsername: "gaian",
  },
  {
    id: "exact-mention-entity",
    message: {
      text: "@GaianChat_Bot hi @gaian",
      entities: [{ type: "mention", offset: 18, length: 6 }],
      chat: { id: 1, type: "supergroup" },
    },
    botUsername: "gaian",
  },
  {
    id: "bot-command-for-this-bot",
    message: {
      text: "/deploy@gaian check status",
      entities: [{ type: "bot_command", offset: 0, length: 13 }],
      chat: { id: 1, type: "supergroup" },
    },
    botUsername: "gaian",
  },
  {
    id: "bot-command-for-other-bot",
    message: {
      text: "/deploy@other_bot check status",
      entities: [{ type: "bot_command", offset: 0, length: 17 }],
      chat: { id: 1, type: "supergroup" },
    },
    botUsername: "gaian",
  },
  {
    id: "substring-of-longer-username",
    message: { text: "@gaianchat_bot hello", chat: { id: 1, type: "supergroup" } },
    botUsername: "gaian",
  },
  {
    id: "prefix-of-another-word",
    message: { text: "@gaianbot do something", chat: { id: 1, type: "supergroup" } },
    botUsername: "gaian",
  },
];

/** Group texts upstream drives through the require-mention activation path. */
const MENTION_TEXT_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
  readonly botUsername: string;
  readonly upstreamTestFile: string;
}> = [
  {
    id: "addressed-status",
    text: "@bot status",
    botUsername: "bot",
    upstreamTestFile: REQUIRE_MENTION_TEST,
  },
  {
    id: "addressed-mid-sentence",
    text: "@bot note the deploy moved",
    botUsername: "bot",
    upstreamTestFile: REQUIRE_MENTION_TEST,
  },
  {
    id: "unaddressed-greeting",
    text: "hello everyone",
    botUsername: "bot",
    upstreamTestFile: REQUIRE_MENTION_TEST,
  },
  {
    id: "ambient-abort-phrase",
    text: "stop",
    botUsername: "bot",
    upstreamTestFile: REQUIRE_MENTION_TEST,
  },
  {
    id: "addressed-after-watermark",
    text: "@bot answer after watermark",
    botUsername: "bot",
    upstreamTestFile: REQUIRE_MENTION_TEST,
  },
  {
    id: "exact-username",
    text: "@gaian what is the group id?",
    botUsername: "gaian",
    upstreamTestFile: HELPERS_TEST,
  },
  {
    id: "trailing-punctuation",
    text: "@gaian, what's up?",
    botUsername: "gaian",
    upstreamTestFile: HELPERS_TEST,
  },
  {
    id: "word-prefix",
    text: "@gaianbot do something",
    botUsername: "gaian",
    upstreamTestFile: HELPERS_TEST,
  },
];

const mentionCases: DifferentialCase[] = [
  ...BOT_MENTION_INPUTS.map(({ id, message, botUsername }) => ({
    id: `hasBotMention/${id}`,
    upstreamTestFile: HELPERS_TEST,
    fn: "src/bot/body-helpers.ts#hasBotMention",
    input: { message, botUsername },
    run: () => hasBotMention(message as unknown as Message, botUsername),
  })),
  ...MENTION_TEXT_INPUTS.map(({ id, text, botUsername, upstreamTestFile }) => ({
    id: `hasBotMentionInText/${id}`,
    upstreamTestFile,
    fn: "src/bot/body-helpers.ts#hasBotMentionInText",
    input: { text, botUsername },
    run: () => hasBotMentionInText(text, botUsername),
  })),
];

// ------------------------------------------------------------------ targets

const PARSE_TARGET_INPUTS: ReadonlyArray<{
  readonly raw: string;
  readonly upstreamTestFile: string;
}> = [
  { raw: "-1001234567890", upstreamTestFile: TARGETS_TEST },
  { raw: "@mychannel", upstreamTestFile: TARGETS_TEST },
  { raw: "-1001234567890:123", upstreamTestFile: TARGETS_TEST },
  { raw: "-1001234567890:topic:456", upstreamTestFile: TARGETS_TEST },
  { raw: "telegram:group:-1001234567890:direct-topic:77", upstreamTestFile: TARGETS_TEST },
  { raw: "-1001234567890:direct-topic:0", upstreamTestFile: TARGETS_TEST },
  { raw: "-1001234567890:abc", upstreamTestFile: TARGETS_TEST },
  { raw: "telegram:group:-1001234567890:topic:456", upstreamTestFile: TARGETS_TEST },
  { raw: "@mychannel:topic:77", upstreamTestFile: SEND_MUTATION_TARGETS_TEST },
  { raw: "", upstreamTestFile: TARGETS_TEST },
];

const STRIP_PREFIX_INPUTS = [
  "telegram:123",
  "telegram:group:-100123",
  "group:-100123",
  "tg:group:-1001234567890:topic:77",
] as const;

const CHAT_ID_INPUTS = [
  "-1001234567890",
  "telegram:https://t.me/MyChannel",
  "@MyChannel",
  "MyChannel",
  "  ",
] as const;

const LOOKUP_TARGET_INPUTS = [
  "telegram:https://t.me/MyChannel",
  "tg:t.me/mychannel",
  "@MyChannel",
  "MyChannel",
  "@bad-handle",
  "@testchannel",
] as const;

const OUTBOUND_TARGET_INPUTS = [
  "group:-1001234567890:topic:77",
  "group:-1001234567890:77",
  "group:-1001234567890:direct-topic:77",
  "group:not-a-number",
] as const;

const NUMERIC_CHAT_ID_INPUTS = ["-1001234567890", "t.me/mychannel"] as const;

const CHAT_TYPE_INPUTS = ["-1001234567890", "123456789", "-1001234567890:abc"] as const;

const targetCases: DifferentialCase[] = [
  ...PARSE_TARGET_INPUTS.map(({ raw, upstreamTestFile }) => ({
    id: `parseTelegramTarget/${raw === "" ? "<empty>" : raw.trim()}`,
    upstreamTestFile,
    fn: "src/targets.ts#parseTelegramTarget",
    input: { raw },
    run: () => parseTelegramTarget(raw),
  })),
  ...STRIP_PREFIX_INPUTS.map((raw) => ({
    id: `stripTelegramInternalPrefixes/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#stripTelegramInternalPrefixes",
    input: { raw },
    run: () => stripTelegramInternalPrefixes(raw),
  })),
  ...CHAT_ID_INPUTS.map((raw) => ({
    id: `normalizeTelegramChatId/${raw.trim() === "" ? "<blank>" : raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#normalizeTelegramChatId",
    input: { raw },
    run: () => normalizeTelegramChatId(raw),
  })),
  ...LOOKUP_TARGET_INPUTS.map((raw) => ({
    id: `normalizeTelegramLookupTarget/${raw}`,
    upstreamTestFile: raw === "@testchannel" ? RESOLVE_TARGETS_TEST : TARGETS_TEST,
    fn: "src/targets.ts#normalizeTelegramLookupTarget",
    input: { raw },
    run: () => normalizeTelegramLookupTarget(raw),
  })),
  ...OUTBOUND_TARGET_INPUTS.map((raw) => ({
    id: `normalizeTelegramOutboundTarget/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#normalizeTelegramOutboundTarget",
    input: { raw },
    run: () => normalizeTelegramOutboundTarget(raw),
  })),
  ...NUMERIC_CHAT_ID_INPUTS.map((raw) => ({
    id: `isNumericTelegramChatId/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#isNumericTelegramChatId",
    input: { raw },
    run: () => isNumericTelegramChatId(raw),
  })),
  ...CHAT_TYPE_INPUTS.map((raw) => ({
    id: `resolveTelegramTargetChatType/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#resolveTelegramTargetChatType",
    input: { target: raw },
    run: () => resolveTelegramTargetChatType(raw),
  })),
];

// ------------------------------------------------------- error classification

const apiError = (message: string, errorCode: number) =>
  Object.assign(new Error(message), { error_code: errorCode });
const codedError = (message: string, code: string) => Object.assign(new Error(message), { code });

/** `error_code` inputs, per predicate: upstream tables one code list per classifier. */
const AUTH_ERROR_CODE_INPUTS: ReadonlyArray<readonly [string, number]> = [
  ["Unauthorized", 401],
  ["Forbidden", 403],
  ["Not Found", 404],
];

const RETRYABLE_ERROR_CODE_INPUTS: ReadonlyArray<readonly [string, number]> = [
  ["Too Many Requests", 429],
  ["Internal Server Error", 500],
  ["Bad Gateway", 502],
  ["Conflict", 409],
];

const SAFE_RETRY_CODE_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["connect ECONNREFUSED", "ECONNREFUSED"],
  ["getaddrinfo ENOTFOUND", "ENOTFOUND"],
  ["getaddrinfo EAI_AGAIN", "EAI_AGAIN"],
  ["read ECONNRESET", "ECONNRESET"],
  ["connect timeout", "UND_ERR_CONNECT_TIMEOUT"],
];

const RECOVERABLE_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly describe: unknown;
  readonly build: () => unknown;
  readonly options?: { context: "send" | "polling" };
}> = [
  {
    id: "etimedout-code",
    describe: { message: "timeout", code: "ETIMEDOUT" },
    build: () => codedError("timeout", "ETIMEDOUT"),
  },
  {
    id: "nested-econnreset-cause",
    describe: { message: "fetch failed", cause: { message: "socket hang up", code: "ECONNRESET" } },
    build: () =>
      Object.assign(new TypeError("fetch failed"), {
        cause: codedError("socket hang up", "ECONNRESET"),
      }),
  },
  {
    id: "undici-snippet-send-context",
    describe: { message: "Undici: socket failure", options: { context: "send" } },
    build: () => new Error("Undici: socket failure"),
    options: { context: "send" },
  },
  {
    id: "grammy-failed-after-envelope",
    describe: {
      message: "Network request for 'sendMessage' failed after 2 attempts.",
      options: { context: "send" },
    },
    build: () => new Error("Network request for 'sendMessage' failed after 2 attempts."),
    options: { context: "send" },
  },
  {
    id: "unrelated-error",
    describe: { message: "invalid token" },
    build: () => new Error("invalid token"),
  },
];

const RETRY_AFTER_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly describe: unknown;
  readonly build: () => unknown;
  readonly upstreamTestFile: string;
}> = [
  {
    id: "top-level-parameters",
    describe: { error_code: 429, parameters: { retry_after: 20 } },
    build: () =>
      Object.assign(apiError("Too Many Requests", 429), { parameters: { retry_after: 20 } }),
    upstreamTestFile: DELIVERY_TRACE_TEST,
  },
  {
    id: "response-parameters",
    describe: { message: "429 Too Many Requests", response: { parameters: { retry_after: 1 } } },
    build: () => ({
      message: "429 Too Many Requests",
      response: { parameters: { retry_after: 1 } },
    }),
    upstreamTestFile: NETWORK_ERRORS_TEST,
  },
];

const EDIT_ERROR_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly message: string;
  readonly upstreamTestFile: string;
}> = [
  {
    id: "grammy-edit-envelope",
    message: "Call to 'editMessageText' failed! (400: Bad Request: message is not modified)",
    upstreamTestFile: DRAFT_STREAM_TEST,
  },
  {
    id: "identical-content",
    message:
      "400: Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
    upstreamTestFile: "extensions/telegram/src/send.test.ts",
  },
];

type SendPredicateName =
  | "isTelegramCaptionTooLongError"
  | "isTelegramPhotoLimitError"
  | "isTelegramVoiceMessagesForbiddenError";

const SEND_PREDICATES: Record<SendPredicateName, (error: unknown) => boolean> = {
  isTelegramCaptionTooLongError,
  isTelegramPhotoLimitError,
  isTelegramVoiceMessagesForbiddenError,
};

const SEND_PREDICATE_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly description: string;
  readonly fn: SendPredicateName;
}> = [
  {
    id: "voice-forbidden",
    description:
      "GrammyError: Call to 'sendVoice' failed! (400: Bad Request: VOICE_MESSAGES_FORBIDDEN)",
    fn: "isTelegramVoiceMessagesForbiddenError",
  },
  {
    id: "caption-too-long",
    description: "GrammyError: Call to 'sendVoice' failed! (400: Bad Request: caption is too long)",
    fn: "isTelegramCaptionTooLongError",
  },
  {
    id: "photo-invalid-dimensions",
    description:
      "GrammyError: Call to 'sendPhoto' failed! (400: Bad Request: PHOTO_INVALID_DIMENSIONS)",
    fn: "isTelegramPhotoLimitError",
  },
  {
    id: "photo-too-big",
    description: "Bad Request: PHOTO_TOO_BIG",
    fn: "isTelegramPhotoLimitError",
  },
];

const errorCases: DifferentialCase[] = [
  ...AUTH_ERROR_CODE_INPUTS.map(([message, errorCode]) => ({
    id: `isTelegramAuthenticationError/${errorCode}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramAuthenticationError",
    input: { message, error_code: errorCode },
    run: () => isTelegramAuthenticationError(apiError(message, errorCode)),
  })),
  {
    id: "isTelegramAuthenticationError/unstructured-message",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramAuthenticationError",
    input: { message: "Unauthorized" },
    run: () => isTelegramAuthenticationError(new Error("Unauthorized")),
  },
  ...RETRYABLE_ERROR_CODE_INPUTS.map(([message, errorCode]) => ({
    id: `isRetryableTelegramApiError/${errorCode}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isRetryableTelegramApiError",
    input: { message, error_code: errorCode },
    run: () => isRetryableTelegramApiError(apiError(message, errorCode)),
  })),
  ...(["500", "403"] as const).map((code) => ({
    id: `isTelegramServerError/${code}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramServerError",
    input: { error_code: Number(code) },
    run: () => isTelegramServerError(apiError(`error ${code}`, Number(code))),
  })),
  ...(["400", "403"] as const).map((code) => ({
    id: `isTelegramBadRequestError/${code}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramBadRequestError",
    input: { error_code: Number(code) },
    run: () => isTelegramBadRequestError(apiError(`error ${code}`, Number(code))),
  })),
  {
    id: "isTelegramRateLimitError/error-code-429",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramRateLimitError",
    input: { message: "Too Many Requests", error_code: 429 },
    run: () => isTelegramRateLimitError(apiError("Too Many Requests", 429)),
  },
  {
    id: "isTelegramRateLimitError/wrapped-retry-after-without-error-code",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isTelegramRateLimitError",
    input: { message: "429 Too Many Requests", response: { parameters: { retry_after: 1 } } },
    run: () =>
      isTelegramRateLimitError({
        message: "429 Too Many Requests",
        response: { parameters: { retry_after: 1 } },
      }),
  },
  ...SAFE_RETRY_CODE_INPUTS.map(([message, code]) => ({
    id: `isSafeToRetrySendError/${code}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isSafeToRetrySendError",
    input: { message, code },
    run: () => isSafeToRetrySendError(codedError(message, code)),
  })),
  {
    id: "shouldRetryTelegramSendError/pre-connect-refused",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#shouldRetryTelegramSendError",
    input: { message: "connect ECONNREFUSED", code: "ECONNREFUSED" },
    run: () => shouldRetryTelegramSendError(codedError("connect ECONNREFUSED", "ECONNREFUSED")),
  },
  {
    id: "shouldRetryTelegramSendError/ambiguous-econnreset",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#shouldRetryTelegramSendError",
    input: { message: "read ECONNRESET", code: "ECONNRESET" },
    run: () => shouldRetryTelegramSendError(codedError("read ECONNRESET", "ECONNRESET")),
  },
  {
    id: "isSafeToRetrySendError/plain-bad-request",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isSafeToRetrySendError",
    input: { message: "400: Bad Request" },
    run: () => isSafeToRetrySendError(new Error("400: Bad Request")),
  },
  {
    id: "isSafeToRetrySendError/null",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isSafeToRetrySendError",
    input: { error: null },
    run: () => isSafeToRetrySendError(null),
  },
  {
    id: "isSafeToRetrySendError/nested-preconnect-cause",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isSafeToRetrySendError",
    input: { message: "fetch failed", cause: { message: "ECONNREFUSED", code: "ECONNREFUSED" } },
    run: () =>
      isSafeToRetrySendError(
        Object.assign(new Error("fetch failed"), {
          cause: codedError("ECONNREFUSED", "ECONNREFUSED"),
        }),
      ),
  },
  {
    id: "shouldRetryTelegramSendError/rate-limit",
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#shouldRetryTelegramSendError",
    input: { message: "Too Many Requests", error_code: 429 },
    run: () => shouldRetryTelegramSendError(apiError("Too Many Requests", 429)),
  },
  ...RECOVERABLE_INPUTS.map(({ id, describe, build, options }) => ({
    id: `isRecoverableTelegramNetworkError/${id}`,
    upstreamTestFile: NETWORK_ERRORS_TEST,
    fn: "src/network-errors.ts#isRecoverableTelegramNetworkError",
    input: describe,
    run: () =>
      options
        ? isRecoverableTelegramNetworkError(build(), options)
        : isRecoverableTelegramNetworkError(build()),
  })),
  ...RETRY_AFTER_INPUTS.map(({ id, describe, build, upstreamTestFile }) => ({
    id: `readTelegramRetryAfterMs/${id}`,
    upstreamTestFile,
    fn: "src/network-errors.ts#readTelegramRetryAfterMs",
    input: describe,
    run: () => readTelegramRetryAfterMs(build()),
  })),
  ...EDIT_ERROR_INPUTS.flatMap(({ id, message, upstreamTestFile }) => [
    {
      id: `isTelegramMessageNotModifiedError/${id}`,
      upstreamTestFile,
      fn: "src/network-errors.ts#isTelegramMessageNotModifiedError",
      input: { message },
      run: () => isTelegramMessageNotModifiedError(new Error(message)),
    },
    {
      id: `isTelegramEditTargetMissingError/${id}`,
      upstreamTestFile,
      fn: "src/network-errors.ts#isTelegramEditTargetMissingError",
      input: { message },
      run: () => isTelegramEditTargetMissingError(new Error(message)),
    },
  ]),
  // One predicate per description, plus the two cross-checks that pin which
  // predicate owns a description upstream routes to a single fallback.
  ...SEND_PREDICATE_INPUTS.map(({ id, description, fn }) => ({
    id: `${fn}/${id}`,
    upstreamTestFile: DELIVERY_TEST,
    fn: `src/send-error-predicates.ts#${fn}`,
    input: { description },
    run: () => SEND_PREDICATES[fn]({ description }),
  })),
  {
    id: "isTelegramCaptionTooLongError/voice-forbidden",
    upstreamTestFile: DELIVERY_TEST,
    fn: "src/send-error-predicates.ts#isTelegramCaptionTooLongError",
    input: { description: SEND_PREDICATE_INPUTS[0]?.description },
    run: () =>
      isTelegramCaptionTooLongError({ description: SEND_PREDICATE_INPUTS[0]?.description }),
  },
  {
    id: "isTelegramVoiceMessagesForbiddenError/caption-too-long",
    upstreamTestFile: DELIVERY_TEST,
    fn: "src/send-error-predicates.ts#isTelegramVoiceMessagesForbiddenError",
    input: { description: SEND_PREDICATE_INPUTS[1]?.description },
    run: () =>
      isTelegramVoiceMessagesForbiddenError({ description: SEND_PREDICATE_INPUTS[1]?.description }),
  },
];

export const telegramDifferentialCases: readonly DifferentialCase[] = [
  ...formattingCases,
  ...chunkingCases,
  ...mentionCases,
  ...targetCases,
  ...errorCases,
];

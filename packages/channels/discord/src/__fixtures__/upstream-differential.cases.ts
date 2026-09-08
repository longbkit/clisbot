// Differential corpus inputs for the Discord pure functions ported verbatim.
//
// Every case names the upstream test file its input came from. Inputs are
// harvested from upstream; outputs are recorded from the local functions into
// `upstream-differential.json` by `scripts/channel-differential-fixtures.mjs`
// and replayed by `upstream-differential.test.ts`.
//
// Add a case when a ported pure function gains upstream coverage; never edit
// the JSON by hand.
import type { ChannelGroupContext } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { MarkdownTableMode } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { DifferentialCase } from "@getpaseo/channels-shared";
import { chunkDiscordTextWithMode } from "../chunk.js";
import {
  isDiscordHtmlResponseBody,
  isDiscordRateLimitResponseBody,
  summarizeDiscordResponseBody,
} from "../error-body.js";
import {
  resolveDiscordGroupRequireMention,
  resolveDiscordGroupToolPolicy,
} from "../group-policy.js";
import {
  isUnknownDiscordVoiceStateError,
  readDiscordCode,
  readDiscordMessage,
  readRetryAfter,
} from "../internal/rest-errors.js";
import { renderDiscordMarkdown } from "../markdown.js";
import {
  discordTextHasBroadcastMention,
  formatMention,
  rewriteDiscordKnownMentions,
} from "../mentions.js";
import {
  looksLikeDiscordTargetId,
  normalizeDiscordMessagingTarget,
  normalizeDiscordOutboundTarget,
} from "../normalize.js";
import { parseDiscordSendTarget } from "../send-target-parsing.js";
import { parseDiscordTarget, resolveDiscordChannelId } from "../target-parsing.js";

const MARKDOWN_TEST = "extensions/discord/src/markdown.test.ts";
const CHUNK_TEST = "extensions/discord/src/chunk.test.ts";
const WEBHOOK_CHUNK_TEST = "extensions/discord/src/send.webhook.chunk-limit.test.ts";
const MENTIONS_TEST = "extensions/discord/src/mentions.test.ts";
const TARGETS_TEST = "extensions/discord/src/targets.test.ts";
const TARGET_RESOLVER_TEST = "extensions/discord/src/channel.target-resolver.test.ts";
const NORMALIZE_TEST = "extensions/discord/src/normalize.test.ts";
const ERROR_BODY_TEST = "extensions/discord/src/error-body.test.ts";
const REST_ERRORS_TEST = "extensions/discord/src/internal/rest-errors.redaction.test.ts";
const API_TEST = "extensions/discord/src/api.test.ts";

// --------------------------------------------------------------- formatting

/** The Discord-markdown source upstream asserts stays byte-identical, line by line. */
const DISCORD_MARKDOWN_SOURCE = [
  "~~~ts",
  "const value = `inline`;",
  "~~~",
  "",
  "[docs](https://example.test/a_(b)) <@123> ||spoiler||",
  "> quote",
  "* parent",
  "  1. child",
  String.raw`\*literal\* __bold__`,
].join("\n");

const MARKDOWN_TABLE = "| A | B |\n| - | - |\n| x | y |";

const MARKDOWN_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly markdown: string;
  readonly tableMode: MarkdownTableMode;
}> = [
  { id: "discord-source-roundtrip", markdown: DISCORD_MARKDOWN_SOURCE, tableMode: "off" },
  { id: "tilde-fence", markdown: "~~~ts\nconst value = `inline`;\n~~~", tableMode: "off" },
  {
    id: "link-with-parenthesized-target",
    markdown: "[docs](https://example.test/a_(b)) <@123> ||spoiler||",
    tableMode: "off",
  },
  { id: "blockquote", markdown: "> quote", tableMode: "off" },
  { id: "nested-list", markdown: "* parent\n  1. child", tableMode: "off" },
  { id: "escaped-emphasis", markdown: String.raw`\*literal\* __bold__`, tableMode: "off" },
  { id: "underscore-bold", markdown: "__bold__", tableMode: "off" },
  { id: "table-off", markdown: MARKDOWN_TABLE, tableMode: "off" },
  { id: "table-code", markdown: MARKDOWN_TABLE, tableMode: "code" },
  { id: "table-block", markdown: MARKDOWN_TABLE, tableMode: "block" },
];

const formattingCases: DifferentialCase[] = [
  ...MARKDOWN_INPUTS.map(({ id, markdown, tableMode }) => ({
    id: `renderDiscordMarkdown/${id}`,
    upstreamTestFile: MARKDOWN_TEST,
    fn: "src/markdown.ts#renderDiscordMarkdown",
    input: { markdown, tableMode },
    run: () => renderDiscordMarkdown(markdown, tableMode),
  })),
  {
    // Length enforcement belongs to chunking, so 2 001 chars must pass through.
    id: "renderDiscordMarkdown/oversized-plain-text",
    upstreamTestFile: MARKDOWN_TEST,
    fn: "src/markdown.ts#renderDiscordMarkdown",
    input: { markdownLength: 2_001, markdownHead: "xxxxxxxxxx", tableMode: "off" },
    run: () => renderDiscordMarkdown("x".repeat(2_001), "off"),
  },
];

// ----------------------------------------------------------------- chunking

type ChunkOptions = {
  readonly maxChars?: number;
  readonly maxLines?: number;
  readonly chunkMode?: "length" | "newline";
};

const REASONING_LINES = Array.from({ length: 25 }, (_, index) => `${index + 1}. line`).join("\n");

/** Chunker inputs are generated, so the corpus stores the recipe, not 4 KB of a. */
const CHUNK_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
  readonly options: ChunkOptions;
  readonly upstreamTestFile: string;
}> = [
  {
    id: "tall-message-under-char-limit",
    text: Array.from({ length: 45 }, (_, index) => `line-${index + 1}`).join("\n"),
    options: { maxChars: 2_000, maxLines: 20, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "first-line-after-flush",
    text: "first\nsecond",
    options: { maxChars: 2_000, maxLines: 1, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "long-line-with-max-lines-one",
    text: `${"x".repeat(35)}\nz`,
    options: { maxChars: 30, maxLines: 1, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "non-finite-limits",
    text: "x".repeat(2_500),
    options: { maxChars: Number.NaN, maxLines: Number.POSITIVE_INFINITY, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "fenced-block-balanced",
    text: `Here is code:\n\n\`\`\`js\n${Array.from({ length: 30 }, (_, index) => `console.log(${index});`).join("\n")}\n\`\`\`\n\nDone.`,
    options: { maxChars: 2_000, maxLines: 10, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "newline-mode-keeps-fence-intact",
    text: "```js\nconst a = 1;\nconst b = 2;\n```\nAfter",
    options: { maxChars: 2_000, maxLines: 50, chunkMode: "newline" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "closing-fence-reserve",
    text: `\`\`\`txt\n${"a".repeat(120)}\n\`\`\``,
    options: { maxChars: 50, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "closing-fence-line-with-tail",
    text: `hi\n\`\`\`lang\n\`\`\`${"z".repeat(1_995)}`,
    options: { maxChars: 2_000, maxLines: 100, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "oversized-opening-fence-line",
    text: `\`\`\`${"a".repeat(2_000)}\nbody line one\nbody line two\n\`\`\``,
    options: { maxChars: 2_000, maxLines: 100, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "reopened-fence-newline",
    text: `\`\`\`ts\nconst value = '${"x".repeat(80)}';\n\`\`\``,
    options: { maxChars: 30, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "impossible-backtick-balance",
    text: "```\nabcdefghij\n```",
    options: { maxChars: 8, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "whitespace-preserved-on-long-lines",
    text: Array.from({ length: 40 }, () => "word").join(" "),
    options: { maxChars: 20, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "cjk-punctuation-split-point",
    text: "一二三四五。六七八九十。甲乙丙丁戊。",
    options: { maxChars: 10, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "surrogate-pairs-at-hard-fallback",
    text: "ab😀cd😀ef",
    options: { maxChars: 3, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "reasoning-italics-by-lines",
    text: `Reasoning:\n_${REASONING_LINES}_`,
    options: { maxChars: 2_000, maxLines: 10, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "reasoning-italics-newline-mode",
    text: `Reasoning:\n_${"a".repeat(4_000)}_`,
    options: { maxChars: 2_000, maxLines: 50, chunkMode: "newline" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "reasoning-italics-tiny-limit",
    text: `Reasoning:\n_${"abcdef".repeat(8)}_`,
    options: { maxChars: 4, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "reasoning-italics-astral",
    text: `Reasoning:\n_${"😀".repeat(24)}_`,
    options: { maxChars: 4, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "inline-code-default-limit",
    text: `\`command ${"--argument=value ".repeat(160)}\``,
    options: { maxChars: 2_000, maxLines: 17, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "inline-code-interior-backticks",
    text: `\`\` ${"a`b ".repeat(40)} \`\``,
    options: { maxChars: 30, maxLines: 17, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "inline-code-unicode-small-limit",
    text: `\`${"😀".repeat(20)}\``,
    options: { maxChars: 5, maxLines: 17, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "no-inline-fragment-fits-hard-cap",
    text: "`aaaa``b`",
    options: { maxChars: 5, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "already-bounded-native-message",
    text: "  ` padded code ` <@123> <:wave:456> </command:789> https://example.test/?q=__x__  ",
    options: {},
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "impossible-fence-packing",
    text: "```txt\n \r\n \n```",
    options: { maxChars: 3, maxLines: 2, chunkMode: "length" },
    upstreamTestFile: CHUNK_TEST,
  },
  {
    id: "webhook-transport-sized-reasoning",
    text: `Reasoning:\n_${"a".repeat(4_000)}_`,
    options: { maxChars: 2_000, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: WEBHOOK_CHUNK_TEST,
  },
  {
    id: "webhook-expanded-mention",
    text: `${"a".repeat(1_995)} @ops`,
    options: { maxChars: 2_000, maxLines: 50, chunkMode: "length" },
    upstreamTestFile: WEBHOOK_CHUNK_TEST,
  },
];

const chunkingCases: DifferentialCase[] = CHUNK_INPUTS.map(
  ({ id, text, options, upstreamTestFile }) => ({
    id: `chunkDiscordTextWithMode/${id}`,
    upstreamTestFile,
    fn: "src/chunk.ts#chunkDiscordTextWithMode",
    // The text is summarized: a 4 KB literal in the fixture would bury the diff.
    input: { textLength: text.length, textHead: text.slice(0, 40), ...options },
    run: () => chunkDiscordTextWithMode(text, options),
  }),
);

// ----------------------------------------------------------------- mentions

const FORMAT_MENTION_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly params: Record<string, string | number | null>;
}> = [
  { id: "user-id", params: { userId: "123456789" } },
  { id: "role-id", params: { roleId: "987654321" } },
  { id: "channel-id", params: { channelId: "777555333" } },
  { id: "no-id", params: {} },
  { id: "two-ids", params: { userId: "1", roleId: "2" } },
  { id: "non-snowflake-user", params: { userId: "jane" } },
];

/**
 * Handle → id resolution runs through the pure `mentionAliases` config rather
 * than the module-level directory cache upstream primes with
 * `rememberDiscordDirectoryUser`, so every case stays stateless.
 */
const ALICE_ALIASES = { alice: "123456789" } as const;

const REWRITE_MENTION_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
  readonly params: { accountId?: string; mentionAliases?: Record<string, string> };
}> = [
  {
    id: "configured-aliases",
    text: "ping @Vladislava and @BuildBot#1234",
    params: {
      accountId: "default",
      mentionAliases: { BuildBot: "222222222", Vladislava: "333333333" },
    },
  },
  {
    id: "alias-key-with-leading-at",
    text: "ping @OpsLead",
    params: { accountId: "default", mentionAliases: { "@opslead": "444444444" } },
  },
  {
    id: "unknown-and-reserved-mentions",
    text: "hello @unknown @everyone @here",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "balanced-inline-and-fenced-code",
    text: "inline `@alice` fence ```\n@alice\n``` text @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "unterminated-single-backtick",
    text: "outside @alice then `inside @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "unterminated-double-backtick",
    text: "outside @alice then ``inside @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "escaped-literal-backtick",
    text: "literal \\` outside @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "backtick-after-even-backslashes",
    text: "literal \\\\` inside @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "escaped-backtick-before-real-code",
    text: "literal \\` outside @alice then `inside @alice",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "longer-fence-with-interior-triple-backticks",
    text: '````ts\nconst fence = "```";\n@alice\n```` text @alice',
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
  {
    id: "no-at-sign",
    text: "plain text without a mention",
    params: { accountId: "default", mentionAliases: { ...ALICE_ALIASES } },
  },
];

const BROADCAST_MENTION_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["everyone", "heads up @everyone"],
  ["here", "@here please"],
  ["targeted-user", "ping <@123>"],
  ["lookalike", "mail me at a@everyones"],
];

/**
 * `cfg` is the whole OpenClaw config object; only `channels.discord` is read.
 *
 * The `toolsBySender` entries are recorded on purpose: fusion's
 * `resolveScopeToolsPolicy` stops at the node's own `tools` (D-CORE-222), so the
 * sender-override cases record the scope policy, not upstream's per-sender one.
 */
const DISCORD_GUILD_CONFIG = {
  channels: {
    discord: {
      token: "discord-test",
      guilds: {
        guild1: {
          requireMention: false,
          tools: { allow: ["message.guild"] },
          toolsBySender: { "id:user:guild-admin": { allow: ["sessions.list"] } },
          channels: {
            "123": {
              requireMention: true,
              tools: { allow: ["message.channel"] },
              toolsBySender: { "id:user:channel-admin": { deny: ["exec"] } },
            },
          },
        },
      },
    },
  },
};

const GROUP_POLICY_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly params: Record<string, unknown>;
}> = [
  { id: "channel-policy-wins", params: { cfg: DISCORD_GUILD_CONFIG, groupSpace: "guild1", groupId: "123" } },
  {
    id: "guild-policy-fallback",
    params: { cfg: DISCORD_GUILD_CONFIG, groupSpace: "guild1", groupId: "missing" },
  },
  {
    id: "channel-sender-override",
    params: {
      cfg: DISCORD_GUILD_CONFIG,
      groupSpace: "guild1",
      groupId: "123",
      senderId: "user:channel-admin",
    },
  },
  {
    id: "guild-sender-override",
    params: {
      cfg: DISCORD_GUILD_CONFIG,
      groupSpace: "guild1",
      groupId: "missing",
      senderId: "user:guild-admin",
    },
  },
  {
    id: "unmatched-guild",
    params: { cfg: DISCORD_GUILD_CONFIG, groupSpace: "guild2", groupId: "123" },
  },
];

const mentionCases: DifferentialCase[] = [
  ...FORMAT_MENTION_INPUTS.map(({ id, params }) => ({
    id: `formatMention/${id}`,
    upstreamTestFile: MENTIONS_TEST,
    fn: "src/mentions.ts#formatMention",
    input: params,
    run: () => formatMention(params),
  })),
  ...REWRITE_MENTION_INPUTS.map(({ id, text, params }) => ({
    id: `rewriteDiscordKnownMentions/${id}`,
    upstreamTestFile: MENTIONS_TEST,
    fn: "src/mentions.ts#rewriteDiscordKnownMentions",
    input: { text, params },
    run: () => rewriteDiscordKnownMentions(text, params),
  })),
  ...BROADCAST_MENTION_INPUTS.map(([id, text]) => ({
    id: `discordTextHasBroadcastMention/${id}`,
    upstreamTestFile: MENTIONS_TEST,
    fn: "src/mentions.ts#discordTextHasBroadcastMention",
    input: { text },
    run: () => discordTextHasBroadcastMention(text),
  })),
  ...GROUP_POLICY_INPUTS.flatMap(({ id, params }) => [
    {
      id: `resolveDiscordGroupRequireMention/${id}`,
      upstreamTestFile: TARGETS_TEST,
      fn: "src/group-policy.ts#resolveDiscordGroupRequireMention",
      input: params,
      run: () => resolveDiscordGroupRequireMention(params as unknown as ChannelGroupContext),
    },
    {
      id: `resolveDiscordGroupToolPolicy/${id}`,
      upstreamTestFile: TARGETS_TEST,
      fn: "src/group-policy.ts#resolveDiscordGroupToolPolicy",
      input: params,
      run: () => resolveDiscordGroupToolPolicy(params as unknown as ChannelGroupContext),
    },
  ]),
];

// ------------------------------------------------------------------ targets

const PARSE_TARGET_INPUTS: ReadonlyArray<{
  readonly raw: string;
  readonly options?: { defaultKind: "channel" | "user" };
}> = [
  { raw: "<@123>" },
  { raw: "<@!456>" },
  { raw: "user:789" },
  { raw: "discord:user:987" },
  { raw: "channel:555" },
  { raw: "discord:channel:555" },
  { raw: "general" },
  { raw: "123" },
  { raw: "@bob" },
  { raw: "123456789" },
  { raw: "" },
  { raw: "123", options: { defaultKind: "channel" } },
];

const RESOLVE_CHANNEL_INPUTS = ["channel:123", "123", "user:123", "general"] as const;

/** Inputs the messaging target resolver hands the parser upstream. */
const SEND_TARGET_INPUTS: ReadonlyArray<{
  readonly raw: string;
  readonly options?: { defaultKind: "channel" | "user" };
}> = [
  { raw: "jane" },
  { raw: "channel:missing" },
  { raw: "user:missing" },
  { raw: "general" },
  { raw: "456", options: { defaultKind: "channel" } },
];

const MESSAGING_TARGET_INPUTS = ["123", "1234567890", "user:123", "   "] as const;

const OUTBOUND_TARGET_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly raw: string;
  readonly allowFrom?: readonly string[];
}> = [
  { id: "bare-id", raw: "1234567890" },
  { id: "explicit-user", raw: "user:42" },
  { id: "blank", raw: "   " },
  { id: "allow-from-bare-id", raw: "1234567890", allowFrom: ["1234567890"] },
  { id: "allow-from-mention", raw: "3456789012", allowFrom: ["<@3456789012>"] },
  { id: "allow-from-wildcard", raw: "4567890123", allowFrom: ["*"] },
];

const LOOKS_LIKE_TARGET_INPUTS = [
  "<@!123456>",
  "discord:channel:123456",
  "123456",
  "channel:general",
  "hello world",
] as const;

const targetCases: DifferentialCase[] = [
  ...PARSE_TARGET_INPUTS.map(({ raw, options }) => ({
    id: `parseDiscordTarget/${raw === "" ? "<empty>" : raw}${options ? "+default-channel" : ""}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#parseDiscordTarget",
    input: options ? { raw, options } : { raw },
    run: () => (options ? parseDiscordTarget(raw, options) : parseDiscordTarget(raw)),
  })),
  ...RESOLVE_CHANNEL_INPUTS.map((raw) => ({
    id: `resolveDiscordChannelId/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#resolveDiscordChannelId",
    input: { raw },
    run: () => resolveDiscordChannelId(raw),
  })),
  ...SEND_TARGET_INPUTS.map(({ raw, options }) => ({
    id: `parseDiscordSendTarget/${raw}${options ? "+default-channel" : ""}`,
    upstreamTestFile: TARGET_RESOLVER_TEST,
    fn: "src/send-target-parsing.ts#parseDiscordSendTarget",
    input: options ? { raw, options } : { raw },
    run: () => (options ? parseDiscordSendTarget(raw, options) : parseDiscordSendTarget(raw)),
  })),
  ...MESSAGING_TARGET_INPUTS.map((raw) => ({
    id: `normalizeDiscordMessagingTarget/${raw.trim() === "" ? "<blank>" : raw}`,
    upstreamTestFile: raw === "1234567890" ? NORMALIZE_TEST : TARGETS_TEST,
    fn: "src/normalize.ts#normalizeDiscordMessagingTarget",
    input: { raw },
    run: () => normalizeDiscordMessagingTarget(raw),
  })),
  ...OUTBOUND_TARGET_INPUTS.map(({ id, raw, allowFrom }) => ({
    id: `normalizeDiscordOutboundTarget/${id}`,
    upstreamTestFile: NORMALIZE_TEST,
    fn: "src/normalize.ts#normalizeDiscordOutboundTarget",
    input: allowFrom ? { raw, allowFrom } : { raw },
    run: () =>
      allowFrom
        ? normalizeDiscordOutboundTarget(raw, [...allowFrom])
        : normalizeDiscordOutboundTarget(raw),
  })),
  ...LOOKS_LIKE_TARGET_INPUTS.map((raw) => ({
    id: `looksLikeDiscordTargetId/${raw}`,
    upstreamTestFile: NORMALIZE_TEST,
    fn: "src/normalize.ts#looksLikeDiscordTargetId",
    input: { raw },
    run: () => looksLikeDiscordTargetId(raw),
  })),
];

// ------------------------------------------------------- error classification

const CLOUDFLARE_HTML =
  "<!doctype html><html><head><title>Error 1015</title></head><body><h1>You are being rate limited</h1><script>raw()</script></body></html>";
const CLOUDFLARE_HTML_SHORT = "<html><title>Error 1015</title><body>rate limited</body></html>";

const SUMMARY_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly body: string;
  readonly options?: { emptyText: string };
  readonly upstreamTestFile: string;
}> = [
  { id: "cloudflare-html", body: CLOUDFLARE_HTML, upstreamTestFile: API_TEST },
  { id: "cloudflare-html-short", body: CLOUDFLARE_HTML_SHORT, upstreamTestFile: API_TEST },
  {
    id: "entities-and-whitespace",
    body: "  a &amp; b &lt;c&gt;&nbsp;d  \n  e  ",
    upstreamTestFile: ERROR_BODY_TEST,
  },
  { id: "markup-only", body: "<style>.a{}</style>", upstreamTestFile: ERROR_BODY_TEST },
  {
    id: "markup-only-with-empty-text",
    body: "<style>.a{}</style>",
    options: { emptyText: "empty body" },
    upstreamTestFile: ERROR_BODY_TEST,
  },
  {
    id: "plain-proxy-rejection",
    body: "Proxy rejected request; Authorization: Bot fixture-token",
    upstreamTestFile: REST_ERRORS_TEST,
  },
];

const HTML_BODY_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly body: string;
  readonly contentType?: string | null;
}> = [
  { id: "doctype-html", body: CLOUDFLARE_HTML },
  { id: "html-open-tag", body: CLOUDFLARE_HTML_SHORT },
  { id: "json-with-html-content-type", body: '{"message":"nope"}', contentType: "text/html" },
  { id: "json-with-json-content-type", body: '{"message":"nope"}', contentType: "application/json" },
  { id: "plain-text-without-content-type", body: "Proxy rejected request", contentType: null },
];

const RATE_LIMIT_BODY_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["error-1015", CLOUDFLARE_HTML],
  ["cloudflare-word", "Attention Required! | Cloudflare"],
  ["rate-limit-phrase", "You are being rate limited"],
  ["unrelated", '{"message":"Invalid Form Body"}'],
];

/** Discord error bodies upstream feeds through `DiscordError`/`RateLimitError`. */
const ERROR_BODY_INPUTS: ReadonlyArray<{ readonly id: string; readonly body: unknown }> = [
  { id: "voice-state", body: { message: "Voice request rejected", code: 10_065 } },
  { id: "rate-limit", body: { message: "Rate limited", retry_after: 0.25, global: false, code: 20_028 } },
  { id: "string-code", body: { message: "coded", code: "10065" } },
  { id: "no-code", body: { message: "safe diagnostic" } },
  { id: "blank-message", body: { message: "   ", code: 10_065 } },
];

const RETRY_AFTER_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  readonly fallbackSeconds?: number;
}> = [
  { id: "body-retry-after", body: { retry_after: 0.25 }, headers: {} },
  { id: "header-retry-after", body: {}, headers: { "Retry-After": "7" } },
  { id: "body-wins-over-header", body: { retry_after: 0.25 }, headers: { "Retry-After": "7" } },
  { id: "fallback", body: {}, headers: {}, fallbackSeconds: 1 },
  { id: "no-source", body: {}, headers: {} },
];

const VOICE_STATE_INPUTS: ReadonlyArray<{
  readonly id: string;
  readonly describe: unknown;
  readonly build: () => unknown;
}> = [
  {
    id: "discord-code-10065",
    describe: { message: "Voice request rejected", discordCode: 10_065 },
    build: () => Object.assign(new Error("Voice request rejected"), { discordCode: 10_065 }),
  },
  {
    id: "message-match",
    describe: { message: "Unknown Voice State" },
    build: () => new Error("Unknown Voice State"),
  },
  {
    id: "other-discord-code",
    describe: { message: "Invalid Form Body", discordCode: 50_035 },
    build: () => Object.assign(new Error("Invalid Form Body"), { discordCode: 50_035 }),
  },
  { id: "null", describe: { error: null }, build: () => null },
];

const errorCases: DifferentialCase[] = [
  ...SUMMARY_INPUTS.map(({ id, body, options, upstreamTestFile }) => ({
    id: `summarizeDiscordResponseBody/${id}`,
    upstreamTestFile,
    fn: "src/error-body.ts#summarizeDiscordResponseBody",
    input: options ? { body, options } : { body },
    run: () => (options ? summarizeDiscordResponseBody(body, options) : summarizeDiscordResponseBody(body)),
  })),
  {
    // Upstream pins the truncation boundary; the input is generated, so summarize it.
    id: "summarizeDiscordResponseBody/utf16-truncation-boundary",
    upstreamTestFile: ERROR_BODY_TEST,
    fn: "src/error-body.ts#summarizeDiscordResponseBody",
    input: { bodyLength: 239 + 2 + 4, bodyHead: "aaaaaaaaaa", note: "239 a + astral emoji + tail" },
    run: () => summarizeDiscordResponseBody(`${"a".repeat(239)}😀tail`),
  },
  ...HTML_BODY_INPUTS.map(({ id, body, contentType }) => ({
    id: `isDiscordHtmlResponseBody/${id}`,
    upstreamTestFile: API_TEST,
    fn: "src/error-body.ts#isDiscordHtmlResponseBody",
    input: { bodyHead: body.slice(0, 40), contentType: contentType ?? null },
    run: () => isDiscordHtmlResponseBody(body, contentType),
  })),
  ...RATE_LIMIT_BODY_INPUTS.map(([id, body]) => ({
    id: `isDiscordRateLimitResponseBody/${id}`,
    upstreamTestFile: API_TEST,
    fn: "src/error-body.ts#isDiscordRateLimitResponseBody",
    input: { bodyHead: body.slice(0, 60) },
    run: () => isDiscordRateLimitResponseBody(body),
  })),
  ...ERROR_BODY_INPUTS.flatMap(({ id, body }) => [
    {
      id: `readDiscordCode/${id}`,
      upstreamTestFile: REST_ERRORS_TEST,
      fn: "src/internal/rest-errors.ts#readDiscordCode",
      input: { body },
      run: () => readDiscordCode(body),
    },
    {
      id: `readDiscordMessage/${id}`,
      upstreamTestFile: REST_ERRORS_TEST,
      fn: "src/internal/rest-errors.ts#readDiscordMessage",
      input: { body, fallback: "Discord API request failed (500)" },
      run: () => readDiscordMessage(body, "Discord API request failed (500)"),
    },
  ]),
  ...RETRY_AFTER_INPUTS.map(({ id, body, headers, fallbackSeconds }) => ({
    id: `readRetryAfter/${id}`,
    upstreamTestFile: REST_ERRORS_TEST,
    fn: "src/internal/rest-errors.ts#readRetryAfter",
    input: { body, headers, fallbackSeconds: fallbackSeconds ?? 0 },
    run: () =>
      readRetryAfter(
        body,
        new Response(null, { status: 429, headers }),
        fallbackSeconds ?? undefined,
      ),
  })),
  ...VOICE_STATE_INPUTS.map(({ id, describe, build }) => ({
    id: `isUnknownDiscordVoiceStateError/${id}`,
    upstreamTestFile: REST_ERRORS_TEST,
    fn: "src/internal/rest-errors.ts#isUnknownDiscordVoiceStateError",
    input: describe,
    run: () => isUnknownDiscordVoiceStateError(build()),
  })),
];

export const discordDifferentialCases: readonly DifferentialCase[] = [
  ...formattingCases,
  ...chunkingCases,
  ...mentionCases,
  ...targetCases,
  ...errorCases,
];

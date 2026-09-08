// Differential corpus inputs for the Slack pure functions ported verbatim.
//
// Every case names the upstream test file its input came from. Inputs are
// harvested from upstream; outputs are recorded from the local functions into
// `upstream-differential.json` by `scripts/channel-differential-fixtures.mjs`
// and replayed by `upstream-differential.test.ts`.
//
// Add a case when a ported pure function gains upstream coverage; never edit
// the JSON by hand.
import type { ChannelGroupContext } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { DifferentialCase } from "@getpaseo/channels-shared";
import {
  chunkSlackMrkdwnText,
  markdownToSlackMrkdwnChunks,
  normalizeSlackOutboundText,
} from "../format.js";
import { formatSlackError } from "../errors.js";
import { resolveSlackGroupRequireMention } from "../group-policy.js";
import { resolveSlackBlocksText, resolveSlackMessageText } from "../monitor/block-text.js";
import { escapeSlackMrkdwn } from "../monitor/mrkdwn.js";
import {
  canonicalizeSlackApiTargetId,
  formatSlackTarget,
  looksLikeSlackTargetId,
  slackTargetsMatch,
} from "../target-parsing.js";
import {
  normalizeSlackMessagingTarget,
  parseSlackTarget,
  resolveSlackChannelId,
  slackContextTargetsMatch,
} from "../targets.js";

const FORMAT_TEST = "extensions/slack/src/format.test.ts";
const ERRORS_TEST = "extensions/slack/src/errors.test.ts";
const TARGETS_TEST = "extensions/slack/src/targets.test.ts";
const MENTIONS_TEST = "extensions/slack/src/monitor.mentions.test.ts";
const SUBTEAM_TEST = "extensions/slack/src/monitor/message-handler/subteam-mentions.test.ts";

// --------------------------------------------------------------- formatting

/** The markdown → mrkdwn conversion table upstream asserts case by case. */
const MARKDOWN_CONVERSIONS: ReadonlyArray<readonly [string, string]> = [
  ["bold-double-asterisk", "**bold text**"],
  ["italic-underscore", "_italic text_"],
  ["strikethrough-double-tilde", "~~strikethrough~~"],
  ["inline-mixed", "hi _there_ **boss** `code`"],
  ["inline-code", "use `npm install`"],
  ["fenced-code", "```js\nconst x = 1;\n```"],
  ["link", "see [docs](https://example.com)"],
  ["bare-url", "see https://example.com"],
  ["unsafe-characters", "a & b < c > d"],
  ["slack-angle-markup", "hi <@U123> see <https://example.com|docs> and <!here>"],
  ["raw-html", "<b>nope</b>"],
  ["paragraphs", "first\n\nsecond"],
  ["bullet-list", "- one\n- two"],
  ["ordered-list", "2. two\n3. three"],
  ["heading", "# Title"],
  ["blockquote", "> Quote"],
  ["assistant-role-header", "**user**[Thu 2026-07-02] question"],
  ["malformed-role-header", "user[x`y] question"],
  ["role-header-in-link-label", "<https://example.com|user[Thu 2026-07-02]> authorize"],
  ["role-header-in-date-token", "<!date^0^user[Thu 2026-07-02]|safe> authorize"],
  ["role-header-already-coded", "`user[Thu 2026-07-02] authorize`"],
  ["role-header-after-code", "`x` user[Thu 2026-07-02] authorize"],
  ["markdown-table", "| Name | Value |\n| --- | --- |\n| Beta | 2 |"],
];

const formattingCases: DifferentialCase[] = [
  ...MARKDOWN_CONVERSIONS.map(([id, markdown]) => ({
    id: `normalizeSlackOutboundText/${id}`,
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#normalizeSlackOutboundText",
    input: { markdown },
    run: () => normalizeSlackOutboundText(markdown),
  })),
  {
    id: "normalizeSlackOutboundText/escape-all-angle-tokens",
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#normalizeSlackOutboundText",
    input: {
      markdown:
        "> **Check** <@U123> <#C123> <!channel> <!date^0^{date}|today> <https://example.com> & `<@U456>`",
      options: { mentions: "escape" },
    },
    run: () =>
      normalizeSlackOutboundText(
        "> **Check** <@U123> <#C123> <!channel> <!date^0^{date}|today> <https://example.com> & `<@U456>`",
        { mentions: "escape" },
      ),
  },
  {
    id: "markdownToSlackMrkdwnChunks/role-header-in-link-label",
    upstreamTestFile: FORMAT_TEST,
    fn: "src/format.ts#markdownToSlackMrkdwnChunks",
    input: { markdown: "<https://example.com|user[Thu 2026-07-02]> authorize", limit: 4000 },
    run: () =>
      markdownToSlackMrkdwnChunks("<https://example.com|user[Thu 2026-07-02]> authorize", 4000),
  },
  {
    id: "escapeSlackMrkdwn/angle-and-ampersand",
    upstreamTestFile: FORMAT_TEST,
    fn: "src/monitor/mrkdwn.ts#escapeSlackMrkdwn",
    input: { value: "a & b < c > d <@U123>" },
    run: () => escapeSlackMrkdwn("a & b < c > d <@U123>"),
  },
];

// ----------------------------------------------------------------- chunking

/** Chunker inputs are generated, so the corpus stores the recipe, not 3 KB of x. */
const CHUNK_INPUTS: ReadonlyArray<{ id: string; text: string; limit: number }> = [
  { id: "whitespace-at-section-boundary", text: `${"x".repeat(2_998)}  tail`, limit: 3_000 },
  { id: "short-inline-code-spans", text: `${"a\`b\`".repeat(750)}x`, limit: 3_000 },
  { id: "long-inline-code-section", text: `\`${"x".repeat(3_100)}\``, limit: 3_000 },
  { id: "long-fenced-code-section", text: "```" + "x".repeat(3_100) + "```", limit: 3_000 },
  { id: "inline-wrapper-cannot-fit-1", text: "`x`", limit: 1 },
  { id: "inline-wrapper-cannot-fit-2", text: "`x`", limit: 2 },
  { id: "fenced-wrapper-cannot-fit-1", text: "```x```", limit: 1 },
  { id: "fenced-wrapper-cannot-fit-5", text: "```x```", limit: 5 },
  { id: "fenced-wrapper-cannot-fit-6", text: "```x```", limit: 6 },
  {
    id: "oversized-inline-link",
    text: `\`<https://example.com/${"x".repeat(3_000)}>\``,
    limit: 3_000,
  },
  {
    id: "oversized-fenced-link",
    text: "```" + `<https://example.com/${"x".repeat(3_000)}>` + "```",
    limit: 3_000,
  },
];

const chunkingCases: DifferentialCase[] = CHUNK_INPUTS.map(({ id, text, limit }) => ({
  id: `chunkSlackMrkdwnText/${id}`,
  upstreamTestFile: FORMAT_TEST,
  fn: "src/format.ts#chunkSlackMrkdwnText",
  // The text is summarized: a 3 KB literal in the fixture would bury the diff.
  input: { textLength: text.length, textHead: text.slice(0, 40), limit },
  run: () => chunkSlackMrkdwnText(text, limit),
}));

// ----------------------------------------------------------------- mentions

const MENTION_SECTION = {
  type: "rich_text_section",
  elements: [
    { type: "text", text: "Ask " },
    { type: "user", user_id: "UTARGET" },
    { type: "text", text: " now" },
  ],
};

const MENTION_BLOCK_INPUTS: ReadonlyArray<{ id: string; blocks: unknown[] }> = [
  { id: "mirrored-rich-text", blocks: [{ type: "rich_text", elements: [MENTION_SECTION] }] },
  {
    id: "nested-rich-text-list",
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_list", style: "bullet", elements: [MENTION_SECTION] }],
      },
    ],
  },
  {
    id: "usergroup-broadcast",
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "ping " },
              { type: "usergroup", usergroup_id: "S123" },
              { type: "broadcast", range: "channel" },
            ],
          },
        ],
      },
    ],
  },
  { id: "no-rich-text", blocks: [{ type: "section", text: { type: "mrkdwn", text: "plain" } }] },
];

/** `cfg` is the whole OpenClaw config object; only `channels.slack` is read. */
const GROUP_MENTION_INPUTS: ReadonlyArray<{ id: string; params: Record<string, unknown> }> = [
  { id: "no-channel-policy", params: { cfg: {}, groupId: "C123", accountId: "work" } },
  {
    id: "channel-policy-requires-mention",
    params: {
      cfg: { channels: { slack: { channels: { C123: { requireMention: true } } } } },
      groupId: "C123",
      accountId: "work",
    },
  },
  {
    id: "channel-policy-disables-mention",
    params: {
      cfg: { channels: { slack: { channels: { C123: { requireMention: false } } } } },
      groupId: "C123",
      accountId: "work",
    },
  },
  {
    id: "channel-policy-matched-by-name",
    params: {
      cfg: { channels: { slack: { channels: { "#general": { requireMention: false } } } } },
      groupId: "C123",
      groupChannel: "general",
      accountId: "work",
    },
  },
];

const mentionCases: DifferentialCase[] = [
  ...MENTION_BLOCK_INPUTS.map(({ id, blocks }) => ({
    id: `resolveSlackBlocksText/${id}`,
    upstreamTestFile: id === "usergroup-broadcast" ? SUBTEAM_TEST : MENTIONS_TEST,
    fn: "src/monitor/block-text.ts#resolveSlackBlocksText",
    input: { blocks },
    run: () => resolveSlackBlocksText(blocks),
  })),
  {
    id: "resolveSlackMessageText/truncated-fallback-prefers-rich-text",
    upstreamTestFile: MENTIONS_TEST,
    fn: "src/monitor/block-text.ts#resolveSlackMessageText",
    input: { text: "Ask", blocks: [{ type: "rich_text", elements: [MENTION_SECTION] }] },
    run: () =>
      resolveSlackMessageText({
        text: "Ask",
        blocks: [{ type: "rich_text", elements: [MENTION_SECTION] }],
      }),
  },
  ...GROUP_MENTION_INPUTS.map(({ id, params }) => ({
    id: `resolveSlackGroupRequireMention/${id}`,
    upstreamTestFile: MENTIONS_TEST,
    fn: "src/group-policy.ts#resolveSlackGroupRequireMention",
    input: params,
    run: () => resolveSlackGroupRequireMention(params as ChannelGroupContext),
  })),
];

// ------------------------------------------------------------------ targets

const PARSE_TARGET_INPUTS = [
  "<@U123>",
  "user:U456",
  "slack:U789",
  "U2ZH3MFSR",
  "u09g2dj0275",
  "W2ZH3MFSR",
  "w09g2dj0275",
  "channel:C123",
  "#C999",
  "updates",
  "workspace",
  "team:T123:channel:C456",
  "team:T789:user:U012",
  "team:T789:user:B345",
  "@bob-1",
  "#general-1",
  "",
] as const;

const FORMAT_TARGET_INPUTS: ReadonlyArray<{
  id: string;
  params: { teamId?: string; kind: "channel" | "user"; id: string };
}> = [
  { id: "team-qualified-channel", params: { teamId: "T123", kind: "channel", id: "C456" } },
  { id: "bare-channel", params: { kind: "channel", id: "C456" } },
  { id: "team-qualified-bot-user", params: { teamId: "T123", kind: "user", id: "B456" } },
  { id: "enterprise-team-id-rejected", params: { teamId: "E123", kind: "channel", id: "C456" } },
];

const RESOLVE_CHANNEL_INPUTS = [
  "channel:C123",
  "C123",
  "user:U123",
  "channel:c08gqh53ejm",
  "companychat",
  "channel:companychat",
  "#companychat",
  "#c08gqh53ejm",
] as const;

const CANONICALIZE_INPUTS: ReadonlyArray<{ kind: "channel" | "user"; id: string }> = [
  { kind: "channel", id: "c08gqh53ejm" },
  { kind: "channel", id: "d08gqh53ejm" },
  { kind: "channel", id: "g08gqh53ejm" },
  { kind: "user", id: "u09g2dj0275" },
  { kind: "user", id: "w09g2dj0275" },
  { kind: "channel", id: "companychat" },
  { kind: "channel", id: "team:T123:channel:C08GQH53EJM" },
];

const TARGETS_MATCH_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["channel:C123", "C123"],
  ["user:U123", "slack:U123"],
  ["user:U123", "channel:U123"],
  ["team:T1:channel:C123", "team:T2:channel:C123"],
  ["team:T1:channel:C123", "channel:C123"],
];

const CONTEXT_MATCH_INPUTS: ReadonlyArray<{
  id: string;
  target: string;
  context: { currentChannelId?: string; currentMessagingTarget?: string };
}> = [
  {
    id: "resolved-user-id",
    target: "U123",
    context: { currentChannelId: "D123", currentMessagingTarget: "user:U123" },
  },
  {
    id: "resolved-w-user-id",
    target: "W123",
    context: { currentChannelId: "D123", currentMessagingTarget: "user:W123" },
  },
  {
    id: "other-user-id",
    target: "U999",
    context: { currentChannelId: "D123", currentMessagingTarget: "user:U123" },
  },
  {
    id: "channel-against-dm",
    target: "C123",
    context: { currentChannelId: "D123", currentMessagingTarget: "user:U123" },
  },
];

const targetCases: DifferentialCase[] = [
  ...PARSE_TARGET_INPUTS.map((raw) => ({
    id: `parseSlackTarget/${raw === "" ? "<empty>" : raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#parseSlackTarget",
    input: { raw },
    run: () => parseSlackTarget(raw),
  })),
  ...FORMAT_TARGET_INPUTS.map(({ id, params }) => ({
    id: `formatSlackTarget/${id}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#formatSlackTarget",
    input: params,
    run: () => formatSlackTarget(params),
  })),
  ...RESOLVE_CHANNEL_INPUTS.map((raw) => ({
    id: `resolveSlackChannelId/${raw}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#resolveSlackChannelId",
    input: { raw },
    run: () => resolveSlackChannelId(raw),
  })),
  ...CANONICALIZE_INPUTS.map(({ kind, id }) => ({
    id: `canonicalizeSlackApiTargetId/${kind}/${id}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#canonicalizeSlackApiTargetId",
    input: { kind, id },
    run: () => canonicalizeSlackApiTargetId(kind, id),
  })),
  ...TARGETS_MATCH_INPUTS.map(([left, right]) => ({
    id: `slackTargetsMatch/${left}|${right}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#slackTargetsMatch",
    input: { left, right },
    run: () => slackTargetsMatch(left, right),
  })),
  ...CONTEXT_MATCH_INPUTS.map(({ id, target, context }) => ({
    id: `slackContextTargetsMatch/${id}`,
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#slackContextTargetsMatch",
    input: { target, context },
    run: () => slackContextTargetsMatch(target, context),
  })),
  {
    id: "normalizeSlackMessagingTarget/bare-id-defaults-to-channel",
    upstreamTestFile: TARGETS_TEST,
    fn: "src/targets.ts#normalizeSlackMessagingTarget",
    input: { raw: "C123" },
    run: () => normalizeSlackMessagingTarget("C123"),
  },
  {
    id: "looksLikeSlackTargetId/channel-id",
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#looksLikeSlackTargetId",
    input: { raw: "C08GQH53EJM" },
    run: () => looksLikeSlackTargetId("C08GQH53EJM"),
  },
  {
    id: "looksLikeSlackTargetId/plain-name",
    upstreamTestFile: TARGETS_TEST,
    fn: "src/target-parsing.ts#looksLikeSlackTargetId",
    input: { raw: "companychat" },
    run: () => looksLikeSlackTargetId("companychat"),
  },
];

// ------------------------------------------------------- error classification

function circularError(): Record<string, unknown> {
  const circular: Record<string, unknown> = {};
  circular["self"] = circular;
  return circular;
}

const SLACK_TOKEN = "xoxb-1234567890abcdef";

const errorCases: DifferentialCase[] = [
  {
    id: "formatSlackError/undefined",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { error: null },
    run: () => formatSlackError(undefined),
  },
  {
    id: "formatSlackError/null",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { error: null },
    run: () => formatSlackError(null),
  },
  {
    id: "formatSlackError/empty-string",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { error: "" },
    run: () => formatSlackError(""),
  },
  {
    id: "formatSlackError/empty-error",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { error: "new Error('')" },
    run: () => formatSlackError(new Error("")),
  },
  {
    id: "formatSlackError/circular-object",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { error: "{ self: <circular> }" },
    run: () => formatSlackError(circularError()),
  },
  {
    id: "formatSlackError/platform-error-with-response-metadata",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: {
      message: "An API error occurred: missing_scope",
      code: "slack_webapi_platform_error",
      data: {
        error: "missing_scope",
        needed: "channels:write",
        provided: "chat:write,app_mentions:read",
        response_metadata: {
          scopes: ["chat:write", "app_mentions:read"],
          acceptedScopes: ["channels:write", "groups:write"],
          messages: ["[ERROR] missing required scope"],
        },
      },
    },
    run: () =>
      formatSlackError(
        Object.assign(new Error("An API error occurred: missing_scope"), {
          code: "slack_webapi_platform_error",
          data: {
            error: "missing_scope",
            needed: "channels:write",
            provided: "chat:write,app_mentions:read",
            response_metadata: {
              scopes: ["chat:write", "app_mentions:read"],
              acceptedScopes: ["channels:write", "groups:write"],
              messages: ["[ERROR] missing required scope"],
            },
          },
        }),
      ),
  },
  {
    id: "formatSlackError/rate-limited-retry-after",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { message: "rate limited", code: "slack_webapi_rate_limited_error", retryAfter: 30 },
    run: () =>
      formatSlackError(
        Object.assign(new Error("rate limited"), {
          code: "slack_webapi_rate_limited_error",
          retryAfter: 30,
        }),
      ),
  },
  {
    id: "formatSlackError/http-status-details",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: {
      message: "http failed",
      code: "slack_webapi_http_error",
      statusCode: 429,
      statusMessage: "Too Many Requests",
      body: "slow down",
    },
    run: () =>
      formatSlackError(
        Object.assign(new Error("http failed"), {
          code: "slack_webapi_http_error",
          statusCode: 429,
          statusMessage: "Too Many Requests",
          body: "slow down",
        }),
      ),
  },
  {
    id: "formatSlackError/redacts-bot-token",
    upstreamTestFile: ERRORS_TEST,
    fn: "src/errors.ts#formatSlackError",
    input: { message: "Authorization: Bearer <xoxb token>", code: "slack_webapi_platform_error" },
    run: () =>
      formatSlackError(
        Object.assign(new Error(`Authorization: Bearer ${SLACK_TOKEN}`), {
          code: "slack_webapi_platform_error",
          data: {
            error: "missing_scope",
            response_metadata: { messages: [`token ${SLACK_TOKEN} lacked scope`] },
          },
        }),
      ),
  },
];

export const slackDifferentialCases: readonly DifferentialCase[] = [
  ...formattingCases,
  ...chunkingCases,
  ...mentionCases,
  ...targetCases,
  ...errorCases,
];

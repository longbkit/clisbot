// COMPAT(clisbot-control-plane): targeted tests for the Slack outbound path
// — the C5 mrkdwn escape (agent markdown must not post raw/broken entities)
// and the thread targeting. A fake write client (registered through the
// web-api test seam) records the `chat.postMessage` args.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  registerSlackWriteClientForTest,
  slackWebClientStubForTest,
  type WebClient,
} from "./client/web-api.js";
import { normalizeSlackOutboundText } from "./format.js";
import { sendMedia, sendSlackText, updateSlackText } from "./outbound.js";

const CFG = {
  channels: {
    slack: {
      accounts: {
        work: { botToken: "xoxb-test-outbound" },
      },
    },
  },
} as unknown as Record<string, unknown>;

interface RecordedPost {
  args: {
    channel: string;
    text?: string;
    thread_ts?: string;
    blocks?: Record<string, unknown>[];
  };
}

interface RecordedUpdate {
  args: { channel: string; ts: string; text?: string; blocks?: Record<string, unknown>[] };
}

/** A fake write client that records every `chat.postMessage` +
 * `chat.update` call. */
function fakeWriteClient(
  posts: RecordedPost[],
  updates: RecordedUpdate[] = [],
  updateResult: Record<string, unknown> = { ok: true },
): WebClient {
  return {
    ...slackWebClientStubForTest(),
    auth: {
      async test() {
        return { ok: true, user_id: "U_BOT", bot_id: "B_BOT" } as never;
      },
    },
    chat: {
      async postMessage(args: RecordedPost["args"]) {
        posts.push({ args });
        return { ok: true, ts: "123.456", channel: args.channel } as never;
      },
      async update(args: RecordedUpdate["args"]) {
        updates.push({ args });
        return updateResult as never;
      },
    },
    // The G7–G10 upload surface: not exercised here (outbound-media.test.ts
    // owns it) — the stub keeps the fake a valid `WebClient`.
    files: {
      async getUploadURLExternal() {
        return { ok: true, upload_url: "https://files.slack.com/u", file_id: "F1" } as never;
      },
      async completeUploadExternal() {
        return { ok: true } as never;
      },
    },
  } as WebClient;
}

/** The fake the ported send path is handed through `SlackSendOpts.client`.
 * Slice 10b moved `sendSlackText` onto upstream `send.ts`, which builds its
 * write client through the ported `client.ts` cache; upstream's own injection
 * point is the `client` option, so the fake is passed in per call instead of
 * being registered in the cache. `registerSlackWriteClientForTest` still backs
 * the paths that have not moved yet (`updateText`, `sendMedia`). */
let installedFakeClient: WebClient | undefined;

function installFakeClient(
  posts: RecordedPost[],
  updates?: RecordedUpdate[],
  updateResult?: Record<string, unknown>,
): void {
  const client = fakeWriteClient(posts, updates, updateResult);
  installedFakeClient = client;
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-outbound", client);
}

/** `sendSlackText` with the installed fake client injected. */
function postText(args: Record<string, unknown>) {
  return sendSlackText({ ...args, client: installedFakeClient } as never);
}

interface UploadCalls {
  getUploadURLExternal: Array<Record<string, unknown>>;
  completeUploadExternal: Array<Record<string, unknown>>;
}

function okFetch(): typeof globalThis.fetch {
  return (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch;
}

function installFakeClientWithUploads(posts: RecordedPost[], uploads: UploadCalls): void {
  const client = fakeWriteClient(posts);
  client.files = {
    async getUploadURLExternal(args: Record<string, unknown>) {
      uploads.getUploadURLExternal.push(args);
      return { ok: true, upload_url: "https://files.slack.com/u", file_id: "F1" } as never;
    },
    async completeUploadExternal(args: Record<string, unknown>) {
      uploads.completeUploadExternal.push(args);
      return { ok: true } as never;
    },
  };
  installedFakeClient = client;
  registerSlackWriteClientForTest("xoxb-test-outbound", client);
}

describe("sendSlackText — upstream mrkdwn render (format.ts)", () => {
  it("renders code spans, emphasis, and links as mrkdwn; escapes only & < >", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "run `npm test` — a & b < c\n**bold** _em_ [x](https://example.com)",
    });
    expect(posts.length).toBe(1);
    expect(posts[0]?.args.channel).toBe("C1");
    // C5 markdown-aware render: the code span / emphasis markup survives (no
    // backslash-escaping of delimiters), a CommonMark link becomes Slack's
    // `<url|label>` form; only the XML-unsafe `&`/`<` in text leaves are
    // entity-escaped.
    expect(posts[0]?.args.text).toBe(
      "run `npm test` — a &amp; b &lt; c\n*bold* _em_ <https://example.com|x>",
    );
  });

  it("keeps the posted text a string with no unescaped entity chars", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "1 < 2 & 3 > 0",
    });
    const text = posts[0]?.args.text ?? "";
    // Every `&` must belong to an entity and no raw `<`/`>` survives. The
    // upstream renderer (`format.ts` `escapeSlackMrkdwnText`) escapes all three
    // XML-unsafe characters; the retired local renderer left `>` literal.
    expect(text.replace(/&amp;|&lt;|&gt;/g, "")).not.toMatch(/[&<>]/);
    expect(text).toBe("1 &lt; 2 &amp; 3 &gt; 0");
  });

  it("still threads replies via thread_ts", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      threadId: "1787804704.012219",
      text: "in-thread answer",
    });
    expect(posts[0]?.args.thread_ts).toBe("1787804704.012219");
  });
});

// --- the native approval card (COMPAT(clisbot-control-plane)) ----------------

const CARD_BLOCKS: Record<string, unknown>[] = [
  { type: "section", text: { type: "mrkdwn", text: "prompt text" } },
  {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Approve" },
        action_id: "approval_action_1",
        value: "allow:req-1",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Deny" },
        action_id: "approval_action_2",
        value: "deny:req-1",
      },
    ],
  },
];

/**
 * The Hub posts plain markdown (`postFor` passes the agent's answer through
 * untouched), so the drive surface owns the whole mrkdwn render.
 */
const MARKDOWN_SHOWCASE = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "**bold** and *italic* and [a link](https://example.com)",
  "",
  "- bullet one",
  "- bullet two",
  "",
  "1. first",
  "2. second",
  "",
  "> quoted line",
  "",
  "Inline `code` here.",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "| A | B | C |",
  "| --- | --- | --- |",
  "| 1 | 2 | 3 |",
  "| 4 | 5 | 6 |",
  "",
].join("\n");

describe("sendSlackText — markdown showcase", () => {
  it("renders every construct as mrkdwn, with the table as a code block", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({ cfg: CFG, accountId: "work", to: "C1", text: MARKDOWN_SHOWCASE });
    // Slack mrkdwn has no heading, so upstream's renderer (`headingStyle:
    // "rich"`) emits bold; the table rides the channel's default table mode
    // ("code" — Slack declares no plugin default), NOT raw pipes.
    expect(posts[0]?.args.text).toBe(
      [
        "*Heading one*",
        "",
        "*Heading two*",
        "",
        "*bold* and _italic_ and <https://example.com|a link>",
        "",
        "• bullet one",
        "• bullet two",
        "",
        "1. first",
        "2. second",
        "",
        "> quoted line",
        "",
        "Inline `code` here.",
        "",
        "```",
        "const x = 1;",
        "```",
        "```",
        "| A | B | C |",
        "| --- | --- | --- |",
        "| 1 | 2 | 3 |",
        "| 4 | 5 | 6 |",
        "```",
      ].join("\n"),
    );
  });

  it("honours an authored table mode over the channel default", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    const cfg = {
      channels: {
        slack: {
          markdown: { tables: "off" },
          accounts: { work: { botToken: "xoxb-test-outbound" } },
        },
      },
    } as unknown as Record<string, unknown>;
    await postText({
      cfg,
      accountId: "work",
      to: "C1",
      text: "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    });
    expect(posts[0]?.args.text).not.toContain("```");
  });
});

describe("sendSlackText — native card (E1)", () => {
  it("posts the card blocks alongside the escaped text and reports cardPosted", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    const result = await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "prompt text",
      blocks: CARD_BLOCKS,
    });
    expect(posts.length).toBe(1);
    // The blocks ride the same mrkdwn render (the Hub mints CommonMark text;
    // posting it verbatim would show literal `**`/`[x](url)` in the card).
    expect(posts[0]?.args.blocks).toStrictEqual(
      CARD_BLOCKS.map((block: Record<string, unknown>) => {
        const text = block["text"] as Record<string, unknown> | undefined;
        return text?.["type"] === "mrkdwn" && typeof text["text"] === "string"
          ? Object.assign({}, block, {
              text: Object.assign({}, text, { text: normalizeSlackOutboundText(text["text"]) }),
            })
          : block;
      }),
    );
    expect(posts[0]?.args.text).toBe("prompt text");
    expect(result.messageId).toBe("123.456");
    expect(result.cardPosted).toBe(true);
  });

  it("posts plain text (no blocks, no cardPosted) when the arg is absent", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    const result = await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "plain",
    });
    expect(posts[0]?.args.blocks).toBeUndefined();
    expect(result.cardPosted).toBeUndefined();
  });
});

describe("updateSlackText — the card's in-place update", () => {
  it("updates the card in place and strips the blocks by default (clearCard)", async () => {
    const posts: RecordedPost[] = [];
    const updates: RecordedUpdate[] = [];
    installFakeClient(posts, updates);
    const result = await updateSlackText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "Approved Bash (`req-1`) by slack:U0ALICE.",
      externalMessageId: "123.456",
    } as never);
    expect(result.ok).toBe(true);
    expect(updates.length).toBe(1);
    expect(updates[0]?.args).toEqual({
      channel: "C1",
      ts: "123.456",
      // C5: the decided one-liner is escaped at the outbound boundary too.
      text: "Approved Bash (`req-1`) by slack:U0ALICE.",
      blocks: [],
    });
    // The outcome does not re-post a new message.
    expect(posts.length).toBe(0);
  });

  it("keeps the blocks when clearCard is false", async () => {
    const posts: RecordedPost[] = [];
    const updates: RecordedUpdate[] = [];
    installFakeClient(posts, updates);
    await updateSlackText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "keep the card",
      externalMessageId: "123.456",
      clearCard: false,
    } as never);
    expect(updates[0]?.args.blocks).toBeUndefined();
  });

  it("throws when the Web API reports the update failed", async () => {
    const posts: RecordedPost[] = [];
    const updates: RecordedUpdate[] = [];
    installFakeClient(posts, updates, { ok: false, error: "message_not_found" });
    await expect(
      updateSlackText({
        cfg: CFG,
        accountId: "work",
        to: "C1",
        text: "gone",
        externalMessageId: "999.999",
      } as never),
    ).rejects.toThrow(/message_not_found/);
  });
});

describe("sendSlackText — local-file links remain text-only", () => {
  it("does not upload a local file linked in the text", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "File: [chart.png](</tmp/chart.png>)",
    });
    expect(posts.length).toBe(1);
    expect(posts[0]?.args.text).toContain("</tmp/chart.png|chart.png>");
    expect(posts[0]?.args.blocks).toBeUndefined();
  });
});

describe("sendMedia — the G11 gate (notice instead of a silent drop)", () => {
  it("uploads an unmapped file through the generic external upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slack-sendmedia-"));
    const filePath = join(dir, "blob.zip");
    await writeFile(filePath, "z");
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    try {
      const uploads: UploadCalls = { getUploadURLExternal: [], completeUploadExternal: [] };
      installFakeClientWithUploads(posts, uploads);
      const realFetch = globalThis.fetch;
      globalThis.fetch = okFetch();
      const result = await sendMedia({
        cfg: CFG,
        accountId: "work",
        to: "C1",
        filePath,
      } as never);
      expect(result.mediaPosted).toBe(true);
      expect(posts.length).toBe(0);
      expect(uploads.getUploadURLExternal.length).toBe(1);
      expect(uploads.completeUploadExternal.length).toBe(1);
      globalThis.fetch = realFetch;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the local media file is missing", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await expect(
      sendMedia({
        cfg: CFG,
        accountId: "work",
        to: "C1",
        filePath: "/home/u/does/not/exist.png",
      } as never),
    ).rejects.toThrow(/not found/);
    expect(posts.length).toBe(0);
  });
});

// --- the portable presentation (D-W6-01) -------------------------------------
//
// The Hub's `send` reaches Slack through `plugin.outbound.sendText`, so this is
// the production surface for a native chart/table — `presentation-send.test.ts`
// covers the same presentation on the `message` tool's `handleAction` path.

const CHART_AND_TABLE = {
  blocks: [
    {
      type: "chart",
      chartType: "bar",
      title: "Weekly runs",
      categories: ["Mon", "Tue", "Wed"],
      series: [{ name: "runs", values: [3, 5, 4] }],
      xLabel: "Day",
      yLabel: "Runs",
    },
    {
      type: "table",
      caption: "Totals",
      headers: ["A", "B", "C"],
      rows: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    },
  ],
};

describe("sendSlackText — native presentation", () => {
  it("posts the chart and the table as native Block Kit blocks", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    const result = await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "W6CHART-OK",
      presentation: CHART_AND_TABLE,
    });
    const blocks = posts.flatMap((post) => post.args.blocks ?? []);
    expect(blocks.find((block) => block["type"] === "data_visualization")).toMatchObject({
      type: "data_visualization",
      title: "Weekly runs",
      chart: {
        type: "bar",
        axis_config: { categories: ["Mon", "Tue", "Wed"], x_label: "Day", y_label: "Runs" },
      },
    });
    expect(blocks.find((block) => block["type"] === "data_table")).toMatchObject({
      type: "data_table",
      caption: "Totals",
    });
    // Every native post keeps a text fallback: unsupported clients and the
    // notification preview still carry the answer.
    expect(posts.some((post) => (post.args.text ?? "").includes("W6CHART-OK"))).toBe(true);
    // The card flag is what the plane reads to decide a post carries native
    // markup; the ledger confirms the send on the first message's id.
    expect(result.cardPosted).toBe(true);
    expect(result.messageId).toBe("123.456");
  });

  it("posts a table the model wrote without a caption (D-W6-02)", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "W6TABLE-OK",
      presentation: {
        blocks: [{ type: "table", headers: ["X", "Y"], rows: [[1, 2]] }],
      },
    });
    const blocks = posts.flatMap((post) => post.args.blocks ?? []);
    // Core's normalizer refuses a caption-less table; admission fills the
    // caption from the first header instead of dropping the data.
    expect(blocks.find((block) => block["type"] === "data_table")).toMatchObject({
      type: "data_table",
      caption: "X",
    });
  });

  it("posts plain text when the presentation carries no renderable block", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await postText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "W6TEXT-ONLY",
      // Duplicate categories break the portable contract, so core drops the
      // whole presentation at normalization.
      presentation: {
        blocks: [
          {
            type: "chart",
            chartType: "bar",
            title: "Weekly runs",
            categories: ["Mon", "Mon"],
            series: [{ name: "runs", values: [1, 2] }],
          },
        ],
      },
    });
    expect(posts.length).toBe(1);
    expect(posts[0]?.args.blocks?.some((block) => block["type"] === "data_visualization")).not.toBe(
      true,
    );
    expect(posts[0]?.args.text).toBe("W6TEXT-ONLY");
  });
});

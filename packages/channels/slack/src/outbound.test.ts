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
import { renderSlackMrkdwn } from "./mrkdwn.js";
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

function installFakeClient(
  posts: RecordedPost[],
  updates?: RecordedUpdate[],
  updateResult?: Record<string, unknown>,
): void {
  registerSlackWriteClientForTest(
    "xoxb-test-outbound",
    fakeWriteClient(posts, updates, updateResult),
  );
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
  registerSlackWriteClientForTest("xoxb-test-outbound", client);
}

describe("sendSlackText — mrkdwn escape (C5)", () => {
  it("renders code spans, emphasis, and links as mrkdwn; escapes only & < >", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await sendSlackText({
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
    // entity-escaped (`>` is inert in mrkdwn).
    expect(posts[0]?.args.text).toBe(
      "run `npm test` — a &amp; b &lt; c\n*bold* _em_ <https://example.com|x>",
    );
  });

  it("keeps the posted text a string with no unescaped entity chars", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await sendSlackText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "1 < 2 & 3 > 0",
    });
    const text = posts[0]?.args.text ?? "";
    // Every `&` must belong to an entity (`&amp;`/`&lt;`), and no raw `<`
    // survives (`>` needs no escaping in mrkdwn — Slack renders it literal).
    expect(text.replace(/&amp;|&lt;/g, "")).not.toMatch(/[&<]/);
    expect(text).toBe("1 &lt; 2 &amp; 3 > 0");
  });

  it("still threads replies via thread_ts", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    await sendSlackText({
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

describe("sendSlackText — native card (E1)", () => {
  it("posts the card blocks alongside the escaped text and reports cardPosted", async () => {
    const posts: RecordedPost[] = [];
    installFakeClient(posts);
    const result = await sendSlackText({
      cfg: CFG,
      accountId: "work",
      to: "C1",
      text: "prompt text",
      blocks: CARD_BLOCKS,
    } as never);
    expect(posts.length).toBe(1);
    // The blocks ride the same mrkdwn render (the Hub mints CommonMark text;
    // posting it verbatim would show literal `**`/`[x](url)` in the card).
    expect(posts[0]?.args.blocks).toStrictEqual(
      CARD_BLOCKS.map((block: Record<string, unknown>) => {
        const text = block["text"] as Record<string, unknown> | undefined;
        return text?.["type"] === "mrkdwn" && typeof text["text"] === "string"
          ? Object.assign({}, block, {
              text: Object.assign({}, text, { text: renderSlackMrkdwn(text["text"]) }),
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
    const result = await sendSlackText({
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
    await sendSlackText({
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

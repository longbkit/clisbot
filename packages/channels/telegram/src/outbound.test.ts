// Fusion-owned drive-surface tests for `plugin.outbound.*` on the ported
// OpenClaw send path (`send-message.ts`, `send-edit.ts`, `outbound-media.ts`).
//
// D-TG-024: these replace the pre-port `outbound.test.ts` / `outbound-media.test.ts`,
// which asserted against the deleted local reimplementation
// (`client/bot-api.ts#sendTelegramText`, the old `outbound-media.ts#telegramMediaMethod`).
// The behaviours that still exist on the production path are asserted here:
// thread params on every chunk, reply params on chunk 0 only, the mime → Bot API
// method routing, the G11 oversize notice, and the missing-file throw. Cases that
// asserted the old module's internals and have no production equivalent are listed
// in `upstream-sync.json` under D-TG-024.
import { closeSync, ftruncateSync, openSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { HostKeyedStore, HostKeyedStoreOptions, HostRuntime } from "@getpaseo/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";
import { sendMedia, sendText, updateText } from "./outbound.js";

const CFG = {
  channels: {
    telegram: {
      accounts: { bot: { botToken: "123456:tg-test-media-token" } },
    },
  },
} as unknown as Record<string, unknown>;

type ApiCall = { method: string; args: unknown[] };

function createFakeApi(calls: ApiCall[]) {
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      // Upstream's provider-thread proof (`provider-thread-proof.ts`) checks the
      // returned message against the requested topic, so the fake echoes it.
      const params = (args.at(-1) ?? {}) as { message_thread_id?: number };
      return {
        message_id: calls.length,
        chat: { id: -100200300, type: "supergroup", is_forum: true },
        ...(typeof params.message_thread_id === "number"
          ? { message_thread_id: params.message_thread_id, is_topic_message: true }
          : {}),
      };
    };
  return {
    sendMessage: record("sendMessage"),
    sendPhoto: record("sendPhoto"),
    sendDocument: record("sendDocument"),
    sendAnimation: record("sendAnimation"),
    sendVideo: record("sendVideo"),
    sendAudio: record("sendAudio"),
    sendVoice: record("sendVoice"),
    editMessageText: record("editMessageText"),
    editMessageCaption: record("editMessageCaption"),
    editMessageReplyMarkup: record("editMessageReplyMarkup"),
    getChat: async () => ({ id: -100200300, type: "supergroup" }),
    // The rich-blocks send is a raw Bot API call upstream (`send-prepared.ts`).
    raw: { sendRichMessage: record("sendRichMessage") },
  } as unknown as Record<string, unknown>;
}

function memoryKeyedStore(): HostKeyedStore {
  const map = new Map<string, unknown>();
  return {
    register: async (key, value) => void map.set(key, value),
    registerIfAbsent: async (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    update: async (key, updateValue) => {
      const next = updateValue(map.get(key));
      if (next === undefined) return false;
      map.set(key, next);
      return true;
    },
    lookup: async (key) => map.get(key),
    consume: async (key) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: async (key) => map.delete(key),
    entries: async () => [...map].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
    clear: async () => map.clear(),
  };
}

const hostRuntime = {
  state: { openKeyedStore: (_options: HostKeyedStoreOptions) => memoryKeyedStore() },
  logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
} as unknown as HostRuntime;

const tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tg-outbound-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

let calls: ApiCall[];
let api: Record<string, unknown>;

beforeEach(() => {
  setChannelHostRuntime(hostRuntime);
  calls = [];
  api = createFakeApi(calls);
});

function paramsOf(call: ApiCall | undefined): Record<string, unknown> {
  return (call?.args.at(-1) ?? {}) as Record<string, unknown>;
}

describe("sendText — the Hub's final-answer post", () => {
  it("posts one message and returns the native message id", async () => {
    const result = await sendText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      text: "hello",
      api,
    });
    expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
    expect(result.messageId).toBe("1");
  });

  it("carries message_thread_id on EVERY chunk of a multi-chunk topic send", async () => {
    await sendText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      threadId: "42",
      text: `${"a".repeat(4200)}\n\n${"b".repeat(200)}`,
      api,
    });
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(paramsOf(call).message_thread_id).toBe(42);
    }
  });

  it("carries the reply target on chunk 0", async () => {
    await sendText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      text: `${"a".repeat(4200)}\n\n${"b".repeat(200)}`,
      replyTo: 77,
      api,
    });
    expect(calls.length).toBeGreaterThan(1);
    const first = paramsOf(calls[0]);
    expect(first.reply_parameters ?? first.reply_to_message_id).toBeDefined();
  });

  it("rejects a non-numeric topic id instead of sending a malformed request", async () => {
    await expect(
      sendText({ cfg: CFG, accountId: "bot", to: "-100200300", threadId: "abc", text: "x", api }),
    ).rejects.toThrow(/invalid Telegram topic id/);
    expect(calls).toHaveLength(0);
  });
});

/**
 * The Hub posts plain markdown (`postFor` passes the agent's answer through
 * untouched), so the drive surface owns every rendering decision. These cases
 * pin the whole markdown showcase on the two account shapes.
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

describe("sendText — markdown rendering", () => {
  it("renders the showcase as Bot API HTML with the table in a code block", async () => {
    await sendText({ cfg: CFG, accountId: "bot", to: "-100200300", text: MARKDOWN_SHOWCASE, api });
    expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
    expect(paramsOf(calls[0]).parse_mode).toBe("HTML");
    // Byte-for-byte the upstream formatter's output (`markdownToTelegramHtml`
    // with `headingStyle: "none"` — Telegram HTML has no heading tag, so
    // upstream flattens headings, see upstream format.test.ts "flattens
    // headings") at the upstream table mode for a non-rich account: telegram's
    // plugin default is "block", downgraded to "code" without native tables.
    expect(calls[0]?.args[1]).toBe(
      [
        "Heading one",
        "",
        "Heading two",
        "",
        '<b>bold</b> and <i>italic</i> and <a href="https://example.com">a link</a>',
        "",
        "• bullet one",
        "• bullet two",
        "",
        "1. first",
        "2. second",
        "",
        "<blockquote>quoted line</blockquote>",
        "",
        "Inline <code>code</code> here.",
        "",
        '<pre><code class="language-js">const x = 1;\n</code></pre>',
        "<pre><code>| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n</code></pre>",
      ].join("\n"),
    );
  });

  it("renders the showcase as native rich blocks on a richMessages account", async () => {
    const cfg = {
      channels: {
        telegram: {
          accounts: { bot: { botToken: "123456:tg-test-media-token", richMessages: true } },
        },
      },
    } as unknown as Record<string, unknown>;
    await sendText({ cfg, accountId: "bot", to: "-100200300", text: MARKDOWN_SHOWCASE, api });
    expect(calls.map((call) => call.method)).toEqual(["sendRichMessage"]);
    const blocks = (
      paramsOf(calls[0]) as { rich_message?: { blocks?: Array<Record<string, unknown>> } }
    ).rich_message?.blocks;
    expect(blocks?.map((block) => block["type"])).toEqual([
      "heading",
      "heading",
      "paragraph",
      "list",
      "list",
      "blockquote",
      "paragraph",
      "pre",
      // The native table block: the account renders block tables, so the
      // upstream telegram default ("block") survives the resolver.
      "table",
    ]);
    expect(blocks?.[0]).toMatchObject({ type: "heading", text: "Heading one", size: 1 });
    expect(blocks?.[2]).toMatchObject({
      text: [
        { type: "bold", text: "bold" },
        " and ",
        { type: "italic", text: "italic" },
        " and ",
        { type: "url", text: "a link", url: "https://example.com" },
      ],
    });
    const table = blocks?.at(-1) as { cells?: Array<Array<Record<string, unknown>>> };
    expect(table.cells?.[0]?.map((cell) => cell["text"])).toEqual(["A", "B", "C"]);
    expect(table.cells?.[0]?.[0]).toMatchObject({ is_header: true });
    expect(table.cells?.[2]?.map((cell) => cell["text"])).toEqual(["4", "5", "6"]);
  });

  it("honours an authored table mode over the channel default", async () => {
    const cfg = {
      channels: {
        telegram: {
          markdown: { tables: "off" },
          accounts: { bot: { botToken: "123456:tg-test-media-token" } },
        },
      },
    } as unknown as Record<string, unknown>;
    await sendText({
      cfg,
      accountId: "bot",
      to: "-100200300",
      text: "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
      api,
    });
    expect(String(calls[0]?.args[1])).not.toContain("<pre>");
  });
});

/**
 * The portable `presentation` the Hub's `message` tool send carries (D-TG-057).
 * These run the real `plugin.outbound.sendText`, not the vertical's own
 * `handleAction`, because that is the path the Hub drives.
 */
const RICH_CFG = {
  channels: {
    telegram: {
      accounts: { bot: { botToken: "123456:tg-test-media-token", richMessages: true } },
    },
  },
} as unknown as Record<string, unknown>;

const TABLE_PRESENTATION = {
  blocks: [{ type: "table", caption: "Totals", headers: ["A", "B"], rows: [[1, 2]] }],
};

const CHART_PRESENTATION = {
  blocks: [
    {
      type: "chart",
      chartType: "bar",
      title: "Weekly runs",
      categories: ["Mon", "Tue"],
      series: [{ name: "runs", values: [3, 5] }],
    },
  ],
};

describe("sendText — the portable presentation", () => {
  it("posts a table presentation as a native rich table block on a rich account", async () => {
    await sendText({
      cfg: RICH_CFG,
      accountId: "bot",
      to: "-100200300",
      text: "TGTABLE-OK",
      presentation: TABLE_PRESENTATION,
      api,
    });
    expect(calls.map((call) => call.method)).toEqual(["sendRichMessage"]);
    const blocks = (
      paramsOf(calls[0]) as { rich_message?: { blocks?: Array<Record<string, unknown>> } }
    ).rich_message?.blocks;
    expect(blocks?.map((block) => block["type"])).toContain("table");
    const table = blocks?.find((block) => block["type"] === "table") as {
      caption?: unknown;
      cells?: Array<Array<Record<string, unknown>>>;
    };
    expect(table.cells?.[0]?.map((cell) => cell["text"])).toEqual(["A", "B"]);
    expect(table.cells?.[1]?.map((cell) => cell["text"])).toEqual(["1", "2"]);
    // The authored text stays the message body; the table is an extra block.
    expect(blocks?.[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(blocks?.[0])).toContain("TGTABLE-OK");
  });

  it("repairs a caption-less table instead of dropping it (D-W6-02)", async () => {
    await sendText({
      cfg: RICH_CFG,
      accountId: "bot",
      to: "-100200300",
      text: "TGTABLE-NOCAP",
      presentation: { blocks: [{ type: "table", headers: ["Run", "Status"], rows: [["1", "ok"]] }] },
      api,
    });
    const blocks = (
      paramsOf(calls[0]) as { rich_message?: { blocks?: Array<Record<string, unknown>> } }
    ).rich_message?.blocks;
    const table = blocks?.find((block) => block["type"] === "table") as {
      cells?: Array<Array<Record<string, unknown>>>;
    };
    expect(table.cells?.[0]?.map((cell) => cell["text"])).toEqual(["Run", "Status"]);
  });

  it("degrades a table to the HTML fallback on a plain account", async () => {
    await sendText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      text: "TGTABLE-PLAIN",
      presentation: TABLE_PRESENTATION,
      api,
    });
    expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
    const params = paramsOf(calls[0]);
    expect(params.parse_mode).toBe("HTML");
    const html = String(calls[0]?.args[1]);
    expect(html).toContain("TGTABLE-PLAIN");
    expect(html).toContain("Totals");
    // No `<table>` island reaches a plain account: it cannot become a block.
    expect(html).not.toContain("<table>");
  });

  it("renders a chart as text — Telegram has no chart primitive", async () => {
    await sendText({
      cfg: RICH_CFG,
      accountId: "bot",
      to: "-100200300",
      text: "TGCHART-OK",
      presentation: CHART_PRESENTATION,
      api,
    });
    const blocks = (
      paramsOf(calls[0]) as { rich_message?: { blocks?: Array<Record<string, unknown>> } }
    ).rich_message?.blocks;
    expect(blocks?.map((block) => block["type"])).not.toContain("table");
    expect(JSON.stringify(blocks)).toContain("Weekly runs");
  });

  it("compiles presentation buttons into the inline keyboard", async () => {
    await sendText({
      cfg: RICH_CFG,
      accountId: "bot",
      to: "-100200300",
      text: "TGBUTTONS-OK",
      presentation: {
        blocks: [
          {
            type: "buttons",
            buttons: [
              { label: "Approve", value: "approve" },
              { label: "Deny", value: "deny" },
            ],
          },
        ],
      },
      api,
    });
    const keyboard = (
      paramsOf(calls[0]) as { reply_markup?: { inline_keyboard?: Array<Array<{ text?: string }>> } }
    ).reply_markup?.inline_keyboard;
    expect(keyboard?.flat().map((button) => button.text)).toEqual(["Approve", "Deny"]);
  });

  it("leaves a send without a presentation on the text path", async () => {
    await sendText({ cfg: RICH_CFG, accountId: "bot", to: "-100200300", text: "plain", api });
    const blocks = (
      paramsOf(calls[0]) as { rich_message?: { blocks?: Array<Record<string, unknown>> } }
    ).rich_message?.blocks;
    expect(blocks?.map((block) => block["type"])).toEqual(["paragraph"]);
  });
});

describe("updateText — markdown rendering", () => {
  it("renders the edited text as HTML instead of posting raw markdown", async () => {
    await updateText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      text: "**bold** and [a link](https://example.com)",
      externalMessageId: "9",
      api,
    });
    const edit = calls.find((call) => call.method === "editMessageText");
    expect(paramsOf(edit).parse_mode).toBe("HTML");
    expect(String(edit?.args[2])).toBe(
      '<b>bold</b> and <a href="https://example.com">a link</a>',
    );
  });
});

describe("updateText — the approval card's in-place update", () => {
  it("edits the target message", async () => {
    const result = await updateText({
      cfg: CFG,
      accountId: "bot",
      to: "-100200300",
      text: "decided",
      externalMessageId: "9",
      api,
    });
    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.method === "editMessageText")).toBe(true);
  });

  it("rejects a non-numeric message id", async () => {
    await expect(
      updateText({
        cfg: CFG,
        accountId: "bot",
        to: "-100200300",
        text: "x",
        externalMessageId: "nope",
        api,
      }),
    ).rejects.toThrow(/invalid Telegram message id/);
  });
});

describe("sendMedia — the native-media post (G7–G11)", () => {
  it("routes an image through sendPhoto", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "shot.png");
    // A real 8-byte PNG signature + IHDR so upstream's dimension probe answers
    // and the send takes the photo branch instead of the document fallback.
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(240, 20);
    writeFileSync(filePath, png);
    const result = await sendMedia({ cfg: CFG, accountId: "bot", to: "-100200300", filePath, api });
    expect(result.mediaPosted).toBe(true);
    expect(calls.map((call) => call.method)).toContain("sendPhoto");
  });

  it("routes a gif through sendAnimation, not sendPhoto", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "loop.gif");
    writeFileSync(filePath, Buffer.alloc(64, 2));
    await sendMedia({ cfg: CFG, accountId: "bot", to: "-100200300", filePath, api });
    expect(calls.map((call) => call.method)).toContain("sendAnimation");
    expect(calls.map((call) => call.method)).not.toContain("sendPhoto");
  });

  it("uploads an unmapped extension through sendDocument", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "thing.zzz");
    writeFileSync(filePath, Buffer.alloc(32, 3));
    await sendMedia({ cfg: CFG, accountId: "bot", to: "-100200300", filePath, api });
    expect(calls.map((call) => call.method)).toContain("sendDocument");
  });

  it("posts the G11 notice through the text path instead of dropping an oversized file", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "huge.bin");
    // Sparse file: the gate is size-only, so no bytes need to be written.
    const handle = openSync(filePath, "w");
    ftruncateSync(handle, 60 * 1024 * 1024);
    closeSync(handle);
    const result = await sendMedia({ cfg: CFG, accountId: "bot", to: "-100200300", filePath, api });
    expect(result.mediaPosted).toBe(false);
    expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
  });

  it("throws when the local media file is missing", async () => {
    await expect(
      sendMedia({
        cfg: CFG,
        accountId: "bot",
        to: "-100200300",
        filePath: join(await makeDir(), "nope.png"),
        api,
      }),
    ).rejects.toThrow(/local media file not found/);
  });
});

// One Hub process drives every account of every organization. The ported send
// path reads its keyed stores through upstream's zero-arg `getTelegramRuntime()`,
// so the account being served has to travel with the call: a process-global
// runtime would let a second account's send write into the first account's
// stores (and log through its logger) for as long as the first send is awaiting
// the wire.
describe("per-account plugin runtime", () => {
  type StoreWrite = { namespace: string; key: string; value: unknown };

  /** A HostRuntime whose keyed stores record every write, so a send that ran
   * against the wrong account's runtime is visible. */
  function recordingHost(writes: StoreWrite[]): HostRuntime {
    return {
      state: {
        openKeyedStore: (options: HostKeyedStoreOptions) => {
          const store = memoryKeyedStore();
          return {
            ...store,
            register: async (key: string, value: unknown, opts?: unknown) => {
              writes.push({ namespace: options.namespace, key, value });
              return await (
                store.register as (k: string, v: unknown, o?: unknown) => Promise<void>
              )(key, value, opts);
            },
          };
        },
      },
      logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    } as unknown as HostRuntime;
  }

  /** Holds every arrival until `count` sends are in flight together. */
  function barrier(count: number): () => Promise<void> {
    let arrived = 0;
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return async () => {
      arrived += 1;
      if (arrived >= count) open();
      await gate;
    };
  }

  it("keeps two concurrent accounts on their own keyed stores", async () => {
    const writesA: StoreWrite[] = [];
    const writesB: StoreWrite[] = [];
    const gate = barrier(2);
    const cfg = {
      channels: {
        telegram: {
          accounts: {
            "acct-a": { botToken: "123456:tg-acct-a-token" },
            "acct-b": { botToken: "123456:tg-acct-b-token" },
          },
        },
      },
    } as unknown as Record<string, unknown>;
    const send = async (accountId: string, chatId: string, host: HostRuntime): Promise<void> => {
      const api = createFakeApi([]);
      const inner = api["sendMessage"] as (...args: unknown[]) => Promise<unknown>;
      api["sendMessage"] = async (...args: unknown[]) => {
        // Both sends are now awaiting the wire at the same time.
        await gate();
        const sent = (await inner(...args)) as { chat: { id: number } };
        return { ...sent, chat: { ...sent.chat, id: Number(chatId) } };
      };
      await sendText({ cfg, accountId, to: chatId, text: accountId, hostRuntime: host, api });
    };
    await Promise.all([
      send("acct-a", "-100200301", recordingHost(writesA)),
      send("acct-b", "-100200302", recordingHost(writesB)),
    ]);

    const chatIds = (writes: StoreWrite[]): string[] => [
      ...new Set(writes.map((write) => String((write.value as { chatId?: unknown }).chatId))),
    ];
    // The ported sent-message cache is the store both sends write; each account's
    // entries must be in its own host, addressed to its own chat.
    expect(writesA.length).toBeGreaterThan(0);
    expect(writesB.length).toBeGreaterThan(0);
    expect(chatIds(writesA)).toEqual(["-100200301"]);
    expect(chatIds(writesB)).toEqual(["-100200302"]);
  });
});

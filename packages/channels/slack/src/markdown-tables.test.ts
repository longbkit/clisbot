import { describe, expect, it, vi } from "vitest";
import { registerSlackWriteClientForTest, slackWebClientStubForTest } from "./client/web-api.js";
import { resolveSlackMarkdownTableMessages } from "./markdown-tables.js";
import { sendSlackText, updateSlackText } from "./outbound.js";

const TABLE = "| Name | Value |\n| --- | --- |\n| Tiếng Việt | 42 |";
const cfg = { channels: { slack: { accounts: { work: { botToken: "xoxb-tables-test" } } } } };

function compile(text: string, config = cfg) {
  return resolveSlackMarkdownTableMessages({ text, cfg: config, accountId: "work" });
}

function setup() {
  const client = slackWebClientStubForTest();
  const post = vi.fn(async (_args: unknown) => ({ ok: true, channel: "C1", ts: "1.2" }));
  const update = vi.fn(async (_args: unknown) => ({ ok: true }));
  client.chat.postMessage = post as never;
  client.chat.update = update as never;
  registerSlackWriteClientForTest("xoxb-tables-test", client);
  return { client, post, update };
}

describe("forwarded Slack Markdown tables", () => {
  it("posts ordered prose and multiple native tables into the source thread", async () => {
    const { client, post } = setup();
    const receipt = vi.fn();
    await sendSlackText({
      cfg,
      accountId: "work",
      to: "C1",
      threadId: "1.0",
      client,
      text: `**Before**\n\n${TABLE}\n\n*Between*\n\n${TABLE}\n\n[After](https://example.com)`,
      onDeliveryResult: receipt,
    });
    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0]?.[0] as {
      blocks: { type: string; text?: { text: string }; rows?: unknown }[];
      thread_ts: string;
    };
    expect(payload.thread_ts).toBe("1.0");
    expect(payload.blocks.map((block) => block.type)).toEqual([
      "section",
      "data_table",
      "section",
      "data_table",
      "section",
    ]);
    expect(payload.blocks[0]?.text?.text).toBe("*Before*");
    expect(payload.blocks[2]?.text?.text).toBe("_Between_");
    expect(payload.blocks[4]?.text?.text).toBe("<https://example.com|After>");
    expect(payload.blocks[1]?.rows).toEqual([
      [
        { type: "raw_text", text: "Name" },
        { type: "raw_text", text: "Value" },
      ],
      [
        { type: "raw_text", text: "Tiếng Việt" },
        { type: "raw_text", text: "42" },
      ],
    ]);
    expect(receipt).toHaveBeenCalledTimes(1);
  });

  it.each(["code", "off", "bullets"])("respects %s mode at channel and account scope", (mode) => {
    expect(
      compile(TABLE, {
        channels: { slack: { ...cfg.channels.slack, markdown: { tables: mode } } },
      } as never),
    ).toEqual([]);
    expect(
      compile(TABLE, {
        channels: {
          slack: {
            markdown: { tables: "block" },
            accounts: { work: { markdown: { tables: mode } } },
          },
        },
      } as never),
    ).toEqual([]);
  });

  it("does not reinterpret fenced examples or ordinary pipe text", () => {
    expect(compile(`\`\`\`md\n${TABLE}\n\`\`\``)).toEqual([]);
    expect(compile("run a | b and `c | d`")).toEqual([]);
  });

  it("does not confuse authored text with a native-table placeholder", () => {
    const messages = compile(`PASEOSLACKTABLE0END\n\n${TABLE}`);
    expect(messages[0]?.blocks?.[0]).toMatchObject({
      type: "section",
      text: { text: "PASEOSLACKTABLE0END" },
    });
    expect(messages[0]?.blocks?.[1]?.type).toBe("data_table");
    // Entity decoding can expose the same spelling only after the whole-document parse.
    // In that case fall back to rendering the untouched source rather than move its content.
    expect(compile(`PASEO&#83;LACKTABLE0END\n\n${TABLE}`)).toEqual([]);
  });

  it("preserves escaped pipes, link destinations and literal special characters", () => {
    const rendered = compile(
      "| Name | Link |\n| --- | --- |\n| A \\| B & C | [docs](https://example.com) |",
    );
    expect(JSON.stringify(rendered)).toContain("A | B & C");
    expect(JSON.stringify(rendered)).toContain("docs (https://example.com)");
  });

  it("resolves document-wide references on both sides of native tables", () => {
    const messages = compile(
      `Read [report][r].\n\n${TABLE}\n\nSee [report][r].\n\n[r]: https://example.com/report`,
    );
    const blocks = messages.flatMap((message) => message.blocks ?? []);
    expect(blocks).toMatchObject([
      { type: "section", text: { text: "Read <https://example.com/report|report>." } },
      { type: "data_table" },
      { type: "section", text: { text: "See <https://example.com/report|report>." } },
    ]);
  });

  it.each(["> ", "  "])(
    "preserves a contained table when converting a later native table (%s)",
    (prefix) => {
      const contained = TABLE.split("\n")
        .map((line) => prefix + line)
        .join("\n");
      const source = prefix === "  " ? `- Report\n\n${contained}` : contained;
      const messages = compile(`${source}\n\nBetween\n\n${TABLE}`);
      const blocks = messages.flatMap((message) => message.blocks ?? []);
      expect(blocks.filter((block) => block.type === "data_table")).toHaveLength(1);
      const first = blocks[0] as { text: { text: string } };
      expect(first.text.text).toContain("```");
      expect(first.text.text).toContain("Tiếng Việt");
      expect(first.text.text).not.toBe("&gt;");
      if (prefix === "> ") expect(first.text.text).toMatch(/^> ```/);
      else expect(first.text.text).toContain("• Report");
    },
  );

  it("does not duplicate prose or rows when a draft's native table is rejected", async () => {
    const { update } = setup();
    update.mockRejectedValueOnce({ data: { error: "invalid_blocks" } });
    await updateSlackText({
      cfg,
      accountId: "work",
      to: "C1",
      externalMessageId: "1.2",
      clearCard: false,
      text: `Before\n\n${TABLE}\n\nAfter`,
    });
    expect(update).toHaveBeenCalledTimes(2);
    const initial = update.mock.calls[0]?.[0] as { text: string };
    expect(initial.text.match(/Tiếng Việt/g)).toHaveLength(1);
    const fallback = update.mock.calls[1]?.[0] as { blocks: { text?: { text: string } }[] };
    const visible = fallback.blocks.map((block) => block.text?.text ?? "").join("\n");
    for (const value of ["Before", "Tiếng Việt", "After"]) {
      expect(visible.split(value)).toHaveLength(2);
    }
    expect(visible.indexOf("Before")).toBeLessThan(visible.indexOf("Tiếng Việt"));
    expect(visible.indexOf("Tiếng Việt")).toBeLessThan(visible.indexOf("After"));
  });

  it.each([
    "| A | B |\n| --- | --- |\n| empty | |",
    `| A |\n| --- |\n${Array.from({ length: 101 }, (_, i) => `| row-${i} |`).join("\n")}`,
    `| A |\n| --- |\n| ${"x".repeat(10_001)} |`,
  ])("keeps unsupported table data in code blocks", async (text) => {
    const { client, post } = setup();
    await sendSlackText({ cfg, accountId: "work", to: "C1", client, text });
    const messages = post.mock.calls.map(
      ([value]) => value as { text: string; blocks?: unknown[] },
    );
    expect(messages.every((message) => !message.blocks)).toBe(true);
    expect(messages.map((message) => message.text).join("\n")).toContain("```");
    expect(messages.length).toBeGreaterThan(0);
  });

  it("falls back without losing rows when Slack rejects native blocks", async () => {
    const { client, post } = setup();
    post.mockRejectedValueOnce({ data: { error: "invalid_blocks" } });
    await sendSlackText({ cfg, accountId: "work", to: "C1", client, text: TABLE });
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(post.mock.calls[1])).toContain("Tiếng Việt");
    expect(JSON.stringify(post.mock.calls[1])).toContain("42");
  });

  it("renders and then clears tables during edits of the same draft", async () => {
    const { update } = setup();
    const args = { cfg, accountId: "work", to: "C1", externalMessageId: "1.2", clearCard: false };
    await updateSlackText({ ...args, text: TABLE });
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      ts: "1.2",
      blocks: [{ type: "data_table" }],
    });
    await updateSlackText({ ...args, text: "**Revised**" });
    // Slack removes old blocks when text is supplied without a blocks field.
    expect(update.mock.calls[1]?.[0]).toMatchObject({ ts: "1.2", text: "*Revised*" });
    expect(update.mock.calls[1]?.[0]).not.toHaveProperty("blocks");
  });
});

import { describe, expect, test } from "bun:test";
import { resolveSlackMessageContent } from "../src/channels/slack/content.ts";

describe("resolveSlackMessageContent", () => {
  test("renders markdown to Slack mrkdwn for native mode", () => {
    const resolved = resolveSlackMessageContent({
      text: "## Title\n- **Bold** item\n[site](https://example.com)",
      inputFormat: "md",
      renderMode: "native",
    });

    expect(resolved).toEqual({
      text: "*Title*\n• *Bold* item\n<https://example.com|site>",
    });
  });

  test("preserves nested markdown list hierarchy in native Slack mrkdwn", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "Priority order:",
        "- `P1` — J4 / PS3: Kiểm soát context gửi vào Copilot",
        "  - Job: auto-detect context hiện tại",
        "  - Problem: thiếu context thì gợi ý kém",
        "  - Status: `done`.",
        "- `P2` — J1 / PS1: Mở Copilot trong ngữ cảnh hiện tại",
        "  - Problem: panel/chat surface riêng làm user rời workflow",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "native",
    });

    expect(resolved.text).toBe([
      "Priority order:",
      "• `P1` — J4 / PS3: Kiểm soát context gửi vào Copilot",
      "  ◦ Job: auto-detect context hiện tại",
      "  ◦ Problem: thiếu context thì gợi ý kém",
      "  ◦ Status: `done`.",
      "• `P2` — J1 / PS1: Mở Copilot trong ngữ cảnh hiện tại",
      "  ◦ Problem: panel/chat surface riêng làm user rời workflow",
    ].join("\n"));
  });

  test("renders markdown to Slack blocks when requested", () => {
    const resolved = resolveSlackMessageContent({
      text: "## Title\n\n### Details\n- first\n- second",
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.text).toBe("Title");
    expect(resolved.apiText).toBe("Title");
    expect(resolved.blocks).toEqual([
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Title",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Details*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "• first\n• second",
        },
      },
    ]);
  });

  test("preserves nested markdown list hierarchy in Slack blocks", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "## Copilot",
        "",
        "Priority order:",
        "- `P1` — J4 / PS3: Kiểm soát context gửi vào Copilot",
        "  - Job: auto-detect context hiện tại",
        "  - Problem: thiếu context thì gợi ý kém",
        "  - Status: `done`.",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.blocks).toEqual([
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Copilot",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            "Priority order:",
            "• `P1` — J4 / PS3: Kiểm soát context gửi vào Copilot",
            "  ◦ Job: auto-detect context hiện tại",
            "  ◦ Problem: thiếu context thì gợi ý kém",
            "  ◦ Status: `done`.",
          ].join("\n"),
        },
      },
    ]);
  });

  test("adds dividers between major sections and bold-flattens deeper headings", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "## First",
        "Intro one.",
        "",
        "#### Note",
        "Body one.",
        "",
        "## Second",
        "Intro two.",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.blocks).toEqual([
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "First",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Intro one.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Note*\nBody one.",
        },
      },
      {
        type: "divider",
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Second",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Intro two.",
        },
      },
    ]);
  });

  test("renders a leading preamble paragraph as context before the first heading", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "[clisbot format test] Slack heading hierarchy markdown -> blocks",
        "",
        "## Vì sao flow này ổn",
        "Body.",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.text).toBe("[clisbot format test] Slack heading hierarchy markdown -> blocks");
    expect(resolved.blocks).toEqual([
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "[clisbot format test] Slack heading hierarchy markdown -> blocks",
          },
        ],
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Vì sao flow này ổn",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Body.",
        },
      },
    ]);
  });

  test("renders a markdown table as a native Slack table block", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "## Test Table",
        "",
        "| Cột | Giá trị |",
        "|---|---|",
        "| App | clisbot |",
        "| Channel | Slack |",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.text).toBe("Test Table");
    expect(resolved.blocks).toEqual([
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Test Table",
        },
      },
      {
        type: "table",
        column_settings: [{ is_wrapped: true }, { is_wrapped: false }],
        rows: [
          [
            { type: "raw_text", text: "Cột" },
            { type: "raw_text", text: "Giá trị" },
          ],
          [
            { type: "raw_text", text: "App" },
            { type: "raw_text", text: "clisbot" },
          ],
          [
            { type: "raw_text", text: "Channel" },
            { type: "raw_text", text: "Slack" },
          ],
        ],
      },
    ]);
  });

  test("falls back after the first native table block to avoid invalid multiple Slack tables", () => {
    const resolved = resolveSlackMessageContent({
      text: [
        "| Key | Value |",
        "|---|---|",
        "| A | one |",
        "",
        "| Key | Value |",
        "|---|---|",
        "| B | two |",
      ].join("\n"),
      inputFormat: "md",
      renderMode: "blocks",
    });

    expect(resolved.blocks).toEqual([
      {
        type: "table",
        column_settings: [{ is_wrapped: true }, { is_wrapped: false }],
        rows: [
          [
            { type: "raw_text", text: "Key" },
            { type: "raw_text", text: "Value" },
          ],
          [
            { type: "raw_text", text: "A" },
            { type: "raw_text", text: "one" },
          ],
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*B*: two",
        },
      },
    ]);
  });

  test("passes raw Slack blocks through and derives fallback text", () => {
    const resolved = resolveSlackMessageContent({
      text: JSON.stringify([
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Ship It",
          },
        },
      ]),
      inputFormat: "blocks",
      renderMode: "none",
    });

    expect(resolved).toEqual({
      text: "Ship It",
      apiText: "Ship It",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Ship It",
          },
        },
      ],
    });
  });
});

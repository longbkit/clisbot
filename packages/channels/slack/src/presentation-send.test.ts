// Fusion-owned end-of-path test for the Slack `message` tool's `send` action
// carrying a portable `presentation` (the Hub mints it in
// `channel-reply-send.ts` and hands it to core's `executeMessageSend`, which
// dispatches into `createSlackActions().handleAction`). It asserts the wire
// call, not the block builders: `data-visualization.test.ts` and
// `native-data-blocks.test.ts` own the portable → native mapping.
//
// The harness is `conversation-open.test.ts`'s: a fake `fetch` under a real
// WebClient, so the assertions read the actual `chat.postMessage` body.
import { WebClient, type WebClientOptions } from "@slack/web-api";
import type { ChannelMessageActionContext } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlackActions } from "./channel-actions.js";
import * as slackClient from "./client.js";

type PostedMessage = { text: string; blocks: Array<Record<string, unknown>> };

const CFG: OpenClawConfig = {
  channels: { slack: { botToken: "xoxb-test", accounts: { default: { botToken: "xoxb-test" } } } },
} as unknown as OpenClawConfig;

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

function installFakeSlack(): PostedMessage[] {
  const posted: PostedMessage[] = [];
  const fetch: NonNullable<WebClientOptions["fetch"]> = async (input, init) => {
    const method = new URL(String(input)).pathname.split("/").at(-1) ?? "";
    const args = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    if (method !== "chat.postMessage") {
      throw new Error(`Unexpected Slack request: ${method}`);
    }
    posted.push({
      text: args.text ?? "",
      blocks: args.blocks ? (JSON.parse(args.blocks) as Array<Record<string, unknown>>) : [],
    });
    return new Response(
      JSON.stringify({ ok: true, channel: args.channel, ts: `17123${posted.length}.567` }),
      { headers: { "content-type": "application/json" } },
    );
  };
  vi.spyOn(slackClient, "getSlackWriteClient").mockImplementation(
    (token, options) => new WebClient(token, { ...options, fetch, retryConfig: { retries: 0 } }),
  );
  return posted;
}

function sendWithPresentation(params: Record<string, unknown>) {
  return createSlackActions("slack").handleAction!({
    channel: "slack",
    action: "send",
    cfg: CFG,
    params,
    accountId: "default",
    requesterAccountId: "default",
    toolContext: {
      currentChannelProvider: "slack",
      currentChannelId: "channel:C09999999",
      replyToMode: "all",
    },
  } as unknown as ChannelMessageActionContext);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message send with a native presentation", () => {
  it("posts the chart as a native data_visualization block and the table as a Block Kit table", async () => {
    const posted = installFakeSlack();
    await sendWithPresentation({
      to: "channel:C09999999",
      message: "Here is the summary",
      presentation: CHART_AND_TABLE,
    });
    const blocks = posted.flatMap((message) => message.blocks);
    const chart = blocks.find((block) => block["type"] === "data_visualization");
    expect(chart).toMatchObject({
      type: "data_visualization",
      title: "Weekly runs",
      chart: {
        type: "bar",
        axis_config: { categories: ["Mon", "Tue", "Wed"], x_label: "Day", y_label: "Runs" },
      },
    });
    const table = blocks.find((block) => block["type"] === "data_table");
    expect(table).toMatchObject({ type: "data_table", caption: "Totals" });
    expect(
      (table as { rows: Array<Array<Record<string, unknown>>> }).rows.map((row) =>
        row.map((cell) => cell["text"]),
      ),
    ).toEqual([
      ["A", "B", "C"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    // Every native post keeps a text fallback so unsupported clients and the
    // notification preview still carry the answer.
    expect(posted.some((message) => message.text.includes("Here is the summary"))).toBe(true);
  });

  it("degrades to plain text when the chart data breaks the portable contract", async () => {
    const posted = installFakeSlack();
    await sendWithPresentation({
      to: "channel:C09999999",
      message: "Broken chart",
      presentation: {
        blocks: [
          {
            type: "chart",
            chartType: "bar",
            title: "Weekly runs",
            // Duplicate categories: core drops the whole presentation at
            // normalization, so the send must still deliver the text instead
            // of posting an invalid native block or nothing at all.
            categories: ["Mon", "Mon"],
            series: [{ name: "runs", values: [1, 2] }],
          },
        ],
      },
    });
    const blocks = posted.flatMap((message) => message.blocks);
    expect(blocks.some((block) => block["type"] === "data_visualization")).toBe(false);
    expect(posted.map((message) => message.text)).toEqual(["Broken chart"]);
  });
});

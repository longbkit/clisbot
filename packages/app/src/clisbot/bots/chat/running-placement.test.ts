import { expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { ChatMessage } from "../data/contracts";
import { buildChatRenderModel, type ChatLiveHead } from "./render-model";
import { toolActivityOf } from "./tool-activity";

const transcript: ChatMessage[] = [
  {
    id: "start",
    seq: 1,
    sender: { kind: "user" },
    text: "same text",
    at: new Date(0).toISOString(),
  },
  {
    id: "steer",
    seq: 2,
    sender: { kind: "user" },
    text: "same text",
    at: new Date(0).toISOString(),
  },
];
function input(id: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id: `native-${id}`,
    clientMessageId: id,
    text: "provider context differs",
    timestamp: new Date(0),
    turnId: "turn",
  };
}
function reply(id: string): Extract<StreamItem, { kind: "assistant_message" }> {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(0), turnId: "turn" };
}
const permission = {
  key: "permission",
  agentId: "agent",
  request: { id: "permission" },
} as ChatLiveHead["permissions"][number];
const head: ChatLiveHead = {
  agentId: "agent",
  turnActive: true,
  permissions: [permission],
  items: [input("start"), reply("before"), input("steer")],
  streamingItems: [reply("after")],
};
const heads = (value: ChatLiveHead) => new Map([["bot", value]]);

it("keeps emitted progress before its exact canonical in-flight input, with one footer/approval", () => {
  const rows = buildChatRenderModel(transcript, heads(head)).rows;
  expect(rows.map((row) => row.key)).toEqual([
    "line:start",
    "live:bot:before:steer",
    "line:steer",
    "live:bot",
  ]);
  const live = rows.filter((row) => row.kind === "live");
  expect(live.map((row) => row.items.map((item) => item.id))).toEqual([["before"], ["after"]]);
  expect(live.map((row) => row.inProgress)).toEqual([true, true]);
  expect(live.map((row) => row.showWorkingIndicator)).toEqual([false, undefined]);
  expect(live.map((row) => row.permissions.length)).toEqual([0, 1]);
});

it("uses identity and session array order even when times are reversed", () => {
  const items = head.items.map((item) => ({ ...item, timestamp: new Date(10000) }));
  const streamingItems = [{ ...reply("after"), timestamp: new Date(1) }];
  const rows = buildChatRenderModel(transcript, heads({ ...head, items, streamingItems })).rows;
  expect(rows.filter((row) => row.kind === "live").map((row) => row.items[0]?.id)).toEqual([
    "before",
    "after",
  ]);
});

it("does not infer a placement from matching text without a canonical input identity", () => {
  const rows = buildChatRenderModel(
    transcript,
    heads({ ...head, items: [reply("before")], streamingItems: [] }),
  ).rows;
  expect(rows.map((row) => row.key)).toEqual(["line:start", "line:steer", "live:bot"]);
});

it("retains the accepted canonical head/tail dedupe before placement", () => {
  const duplicate = reply("before");
  const rows = buildChatRenderModel(
    transcript.slice(0, 1),
    heads({ ...head, items: [input("start"), duplicate], streamingItems: [duplicate] }),
  ).rows;
  expect(
    rows.filter((row) => row.kind === "live").flatMap((row) => row.items.map((item) => item.id)),
  ).toEqual(["before"]);
});

it("keeps existing group discussion projection and its last-prompt boundary", () => {
  const rows = buildChatRenderModel(transcript, heads(head), { group: true }).rows;
  expect(rows.map((row) => row.key)).toEqual(["line:start", "line:steer", "live:bot"]);
  expect(
    rows.filter((row) => row.kind === "live").flatMap((row) => row.items.map((item) => item.id)),
  ).toEqual(["after"]);
});

it("keeps multiple canonical in-flight inputs distinct even with identical text", () => {
  const next = { ...transcript[1]!, id: "steer-again", seq: 3 };
  const model = buildChatRenderModel(
    [...transcript, next],
    heads({
      ...head,
      items: [...head.items, reply("between"), input("steer-again")],
      streamingItems: [reply("after")],
    }),
  );
  expect(model.rows.map((row) => row.key)).toEqual([
    "line:start",
    "live:bot:before:steer",
    "line:steer",
    "live:bot:before:steer-again",
    "line:steer-again",
    "live:bot",
  ]);
});

it("drops temporary segments when the settled transcript references the final native output", () => {
  const final: ChatMessage = {
    id: "final",
    seq: 3,
    sender: { kind: "bot", botId: "bot" },
    text: "after",
    at: new Date(1).toISOString(),
    agentId: "agent",
    timelineItemId: "after",
  };
  const model = buildChatRenderModel(
    [...transcript, final],
    heads({ ...head, turnActive: false, permissions: [] }),
  );
  expect(model.rows.map((row) => row.key)).toEqual(["line:start", "line:steer", "line:final"]);
});

it.each([
  ["HEA", "RTBEAT_OK"],
  ["PA", "SS"],
])("keeps accepted silence policy when %s/%s straddles canonical ingress", (prefix, suffix) => {
  const model = buildChatRenderModel(
    transcript,
    heads({
      ...head,
      items: [
        input("start"),
        { ...reply("prefix"), text: prefix, messageId: "same-native-message" },
        input("steer"),
      ],
      streamingItems: [{ ...reply("suffix"), text: suffix, messageId: "same-native-message" }],
    }),
  );
  expect(model.rows.filter((row) => row.kind === "live").flatMap((row) => row.items)).toEqual([]);
  expect(model.rows.filter((row) => row.kind === "live" && row.inProgress)).toHaveLength(1);
});

it("retains native running tool activity in the prefix while one trailing row owns the footer", () => {
  const tool: StreamItem = {
    kind: "tool_call",
    id: "foreground-tool",
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "mock",
        callId: "foreground-tool",
        name: "read",
        status: "running",
        error: undefined,
        detail: { type: "unknown", input: "", output: null },
      },
    },
  };
  const model = buildChatRenderModel(
    transcript,
    heads({ ...head, items: [input("start"), tool, input("steer")] }),
  );
  const prefix = model.rows.find(
    (row) => row.kind === "live" && row.items.some((item) => item.id === tool.id),
  );
  if (prefix?.kind !== "live") throw new Error("Missing foreground tool prefix");
  expect(toolActivityOf(prefix.items, prefix.inProgress)?.running).toBe(true);
});

const savedRun = { scheduleId: "schedule-a", name: "Saved A", run: 2, maxRuns: 1095 };
const otherRun = { scheduleId: "schedule-b", name: null, run: 9, maxRuns: null };
it.each([
  [undefined, savedRun],
  [savedRun, undefined],
  [savedRun, otherRun],
])(
  "binds each live segment to its own exact scheduled input, not the whole-turn snapshot",
  (first, last) => {
    const lines = transcript.map((line, index) => ({
      ...line,
      scheduleRun: index === 0 ? first : last,
    }));
    const rows = buildChatRenderModel(lines, heads(head)).rows;
    const live = rows.filter((row) => row.kind === "live");
    expect(live.map((row) => row.heartbeatRun)).toEqual([first, last]);
    expect(live.map((row) => row.permissions.length)).toEqual([0, 1]);
    expect(live.map((row) => row.showWorkingIndicator)).toEqual([false, undefined]);
    expect(rows.filter((row) => row.kind === "user").map((row) => row.line.id)).toEqual(
      lines.filter((line) => !line.scheduleRun).map((line) => line.id),
    );
  },
);

it("requires the segment's prompt/output turn identity and preserves notice filtering across the split", () => {
  const notice = (id: string, level: "info" | "warning"): StreamItem => ({
    kind: "notification",
    id,
    timestamp: new Date(0),
    level,
    sourceType: "notification",
    message: "Heartbeat · Saved A · run 2 of 1095",
    turnId: "turn",
  });
  const model = buildChatRenderModel(
    [{ ...transcript[0]!, scheduleRun: savedRun }, transcript[1]!],
    heads({
      ...head,
      items: [
        input("start"),
        notice("scheduled-notice", "info"),
        notice("real-warning", "warning"),
        { ...reply("before"), turnId: "unrelated-turn" },
        input("steer"),
      ],
    }),
  );
  const live = model.rows.filter((row) => row.kind === "live");
  expect(live.map((row) => row.heartbeatRun)).toEqual([undefined, undefined]);
  expect(live.flatMap((row) => row.items.map((item) => item.id))).toEqual([
    "real-warning",
    "before",
    "after",
  ]);
});

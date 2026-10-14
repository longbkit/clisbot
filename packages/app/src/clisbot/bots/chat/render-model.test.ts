import { describe, expect, it } from "vitest";
import type { PendingPermission } from "@/types/shared";
import { applyStreamEvent, type StreamItem } from "@/types/stream";
import type { ChatMessage, ChatMessageSender } from "../data/contracts";
import { buildChatRenderModel, type ChatLiveHead } from "./render-model";

let seq = 0;
function line(sender: ChatMessageSender, at: number, ref?: { agentId: string; itemId: string }) {
  seq += 1;
  const message: ChatMessage = {
    id: `line-${seq}`,
    seq,
    at: new Date(at).toISOString(),
    sender,
    text: `text ${seq}`,
  };
  if (ref) {
    message.agentId = ref.agentId;
    message.timelineItemId = ref.itemId;
  }
  return message;
}

const user = { kind: "user" } as const;
const botA = { kind: "bot", botId: "a" } as const;
const botB = { kind: "bot", botId: "b" } as const;

function assistant(
  id: string,
  at: number,
  messageId?: string,
): Extract<StreamItem, { kind: "assistant_message" }> {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(at), messageId };
}

function tool(id: string, at: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(at),
    payload: {
      source: "agent",
      data: {
        provider: "mock",
        callId: id,
        name: "read",
        status: "completed",
        error: undefined,
        detail: { type: "unknown", input: "", output: null },
      },
    },
  };
}

function userItem(id: string, at: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: new Date(at) };
}

function permission(agentId: string): PendingPermission {
  return {
    key: `${agentId}-perm`,
    agentId,
    request: { id: `${agentId}-perm`, name: "x", input: {} } as PendingPermission["request"],
  };
}

function head(
  agentId: string,
  items: StreamItem[],
  extra: Partial<Pick<ChatLiveHead, "turnActive" | "permissions">> = {},
): ChatLiveHead {
  return { agentId, items, turnActive: false, permissions: [], ...extra };
}

describe("buildChatRenderModel", () => {
  it("groups consecutive lines of one sender and breaks on another", () => {
    const rows = buildChatRenderModel(
      [line(user, 1), line(botA, 2), line(botA, 3), line(botB, 4), line(user, 5), line(user, 6)],
      new Map(),
    ).rows;
    expect(rows.map((row) => [row.kind, "opensGroup" in row ? row.opensGroup : null])).toEqual([
      ["user", true],
      ["bot", true],
      ["bot", false],
      ["bot", true],
      ["user", true],
      ["user", false],
    ]);
  });

  it("a system line renders on its own and reopens the next group", () => {
    const rows = buildChatRenderModel(
      [line(botA, 1), line({ kind: "system" }, 2), line(botA, 3)],
      new Map(),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["bot", "system", "bot"]);
    expect(rows[2]).toMatchObject({ opensGroup: true });
  });

  it("a heartbeat input has no row; a lookalike user stays visible", () => {
    const name = "Heartbeat · Standup · run 2 of 5";
    const heartbeat = { kind: "user", id: "sch_1", displayName: name } as const;
    const run = { ...line(heartbeat, 2), scheduleRun: { scheduleId: "sch_1", run: 2 } };
    // A user who named themselves like a heartbeat stays a user line.
    const lookalike = line({ kind: "user", id: "usr_2", displayName: name }, 4);
    const rows = buildChatRenderModel(
      [line(user, 1), run, line(user, 3), lookalike],
      new Map(),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["user", "user", "user"]);
    expect(rows[1]).toMatchObject({ opensGroup: false });
  });

  it("keeps heartbeat-prefixed errors and warnings beside a silent Bot turn", () => {
    const notices: StreamItem[] = [
      {
        kind: "notification",
        sourceType: "error",
        id: "failure",
        timestamp: new Date(2),
        level: "error",
        message: "Heartbeat · CI · run 2 of 5",
      },
      {
        kind: "notification",
        sourceType: "notification",
        id: "warning",
        timestamp: new Date(3),
        level: "warning",
        message: "Heartbeat · CI · run 2 of 5",
      },
      {
        kind: "notification",
        sourceType: "notification",
        id: "run",
        timestamp: new Date(4),
        level: "info",
        message: "Heartbeat · CI · run 2 of 5",
      },
    ];
    const rows = buildChatRenderModel(
      [],
      new Map([["a", head("agent-a", [...notices, { ...assistant("silent", 5), text: "PASS" }])]]),
    ).rows;
    expect(rows).toMatchObject([{ kind: "live", items: [{ id: "failure" }, { id: "warning" }] }]);
  });

  for (const group of [false, true]) {
    it(`binds ${group ? "group" : "DM"} run counters by reply/input ID and preserves silence`, () => {
      const source = {
        ...line(user, 1),
        scheduleRun: { scheduleId: "schedule-a", run: 2, maxRuns: 5, name: "Saved name" },
      };
      const unrelated = {
        ...line(user, 2),
        scheduleRun: { scheduleId: "schedule-b", run: 9, maxRuns: null, name: null },
      };
      const reply = { ...line(botA, 3), inReplyTo: source.id };
      const manual = { ...line(botA, 5), inReplyTo: line(user, 4).id };
      const silent = { ...line(botA, 6), text: "PASS", inReplyTo: unrelated.id };
      const rows = buildChatRenderModel(
        [source, unrelated, reply, line(user, 4), manual, silent],
        new Map(),
        { group },
      ).rows;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ kind: "bot", heartbeatRun: source.scheduleRun });
      expect(rows[2]).not.toHaveProperty("heartbeatRun");
      const legacy = {
        ...source,
        sender: { kind: "user", displayName: "Heartbeat · Old name · run 2 of 8" } as const,
        scheduleRun: { scheduleId: "schedule-a", run: 2 },
      };
      expect(buildChatRenderModel([legacy, reply], new Map(), { group }).rows[0]).toMatchObject({
        heartbeatRun: { scheduleId: "schedule-a", run: 2, maxRuns: 8 },
      });
      const prompt = {
        ...userItem("prompt", 2),
        clientMessageId: source.id,
        turnId: "heartbeat-turn",
      };
      const partial = {
        ...assistant("partial", 3),
        text: "Meaningful partial",
        turnId: "heartbeat-turn",
      };
      const heads = new Map([["a", head("agent-a", [prompt, partial], { turnActive: true })]]);
      expect(buildChatRenderModel([source], heads, { group }).rows[0]).toMatchObject({
        kind: "live",
        heartbeatRun: source.scheduleRun,
      });
      // A steer/manual prompt in the same provider turn changes the triggering input identity.
      const manualPrompt = { ...prompt, clientMessageId: "manual-input" };
      const manualHeads = new Map([
        ["a", head("agent-a", [manualPrompt, partial], { turnActive: true })],
      ]);
      expect(buildChatRenderModel([source], manualHeads, { group }).rows[0]).toMatchObject({
        heartbeatRun: undefined,
      });
      const silentHeads = new Map([
        ["a", head("agent-a", [prompt, { ...partial, text: "HEARTBEAT_OK" }])],
      ]);
      expect(buildChatRenderModel([source], silentHeads, { group }).rows).toEqual([]);
    });
  }

  it("keeps a turn's lines together but gives a later turn from the same bot its own group", () => {
    const turn = (at: number, turnId: string) => ({
      ...line(botA, at),
      reply: { agentId: "agent-a", turnId },
    });
    // Two lines of one turn, then a heartbeat run in the session with no prompt between.
    const rows = buildChatRenderModel(
      [line(user, 1), turn(2, "t1"), turn(3, "t1"), turn(9, "t2")],
      new Map(),
    ).rows;
    expect(rows.map((row) => ("opensGroup" in row ? row.opensGroup : null))).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });

  it("drops live items a transcript line already references and keeps newer ones", () => {
    const transcript = [
      line(user, 1),
      line(botA, 5, { agentId: "agent-a", itemId: "msg-1" }),
      line(user, 6),
    ];
    const rows = buildChatRenderModel(
      transcript,
      new Map([
        [
          "a",
          head(
            "agent-a",
            [
              userItem("u1", 1),
              tool("t1", 3),
              assistant("msg-1", 5),
              userItem("u2", 6),
              tool("t2", 7),
              assistant("seg-2", 8, "msg-2"),
            ],
            { turnActive: true },
          ),
        ],
      ]),
    ).rows;
    const live = rows[rows.length - 1];
    expect(live).toMatchObject({ kind: "live", botId: "a", inProgress: true, opensGroup: true });
    if (live?.kind !== "live") throw new Error("expected live row");
    expect(live.items.map((item) => item.id)).toEqual(["t2", "seg-2"]);
  });

  it("dedupes by the assistant messageId as well as the item id", () => {
    const transcript = [line(botA, 5, { agentId: "agent-a", itemId: "msg-9" })];
    const rows = buildChatRenderModel(
      transcript,
      new Map([["a", head("agent-a", [assistant("seg-9", 5, "msg-9")])]]),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["bot"]);
  });

  it("cuts by the line's time when the referenced item left the tail", () => {
    const transcript = [line(botA, 50, { agentId: "agent-a", itemId: "gone" })];
    const rows = buildChatRenderModel(
      transcript,
      new Map([["a", head("agent-a", [tool("old", 10), tool("new", 60)])]]),
    ).rows;
    const live = rows[1];
    if (live?.kind !== "live") throw new Error("expected live row");
    expect(live.items.map((item) => item.id)).toEqual(["new"]);
    expect(live.opensGroup).toBe(false);
    expect(live.inProgress).toBe(false);
  });

  it("has no live row for an idle head with nothing left, and one for an active empty head", () => {
    const idle = buildChatRenderModel([], new Map([["a", head("agent-a", [])]])).rows;
    expect(idle).toEqual([]);
    const active = buildChatRenderModel(
      [],
      new Map([["a", head("agent-a", [], { turnActive: true })]]),
    ).rows;
    expect(active).toMatchObject([{ kind: "live", inProgress: true, items: [] }]);
  });

  it("attaches permissions to the bot that owns the agent and ignores other agents' lines", () => {
    const transcript = [line(botB, 1, { agentId: "agent-b", itemId: "x" })];
    const rows = buildChatRenderModel(
      transcript,
      new Map([
        ["a", head("agent-a", [tool("t", 2)], { permissions: [permission("agent-a")] })],
        ["b", head("agent-b", [], { permissions: [permission("agent-b")] })],
      ]),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["bot", "live", "live"]);
    expect(rows[1]).toMatchObject({ botId: "a", permissions: [{ agentId: "agent-a" }] });
    expect(rows[1]).toMatchObject({ items: [{ id: "t" }] });
    expect(rows[2]).toMatchObject({ botId: "b", opensGroup: true, items: [] });
  });
});

describe("group live rows", () => {
  const pass = (id: string, at: number): StreamItem => ({
    kind: "assistant_message",
    id,
    text: "PASS",
    timestamp: new Date(at),
  });

  it("an ended silent turn leaves nothing below the transcript", () => {
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([["b", head("agent-b", [userItem("p1", 2), tool("t1", 3), pass("x1", 4)])]]),
      { group: true },
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["user"]);
  });

  it("a running turn shows only its own work, never PASS or an earlier silent turn", () => {
    const items = [
      userItem("p1", 2),
      pass("x1", 3),
      userItem("p2", 4),
      tool("t2", 5),
      pass("x2", 6),
    ];
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([["b", head("agent-b", items, { turnActive: true })]]),
      { group: true },
    ).rows;
    const live = rows.find((row) => row.kind === "live");
    expect(live?.kind === "live" && live.items.map((item) => item.id)).toEqual(["t2"]);
  });

  it("a direct chat keeps the unreferenced tail as before", () => {
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([["a", head("agent-a", [assistant("late", 2)])]]),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["user", "live"]);
  });
});

describe("silence markers", () => {
  const reply = (id: string, at: number, text: string): StreamItem => ({
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date(at),
  });
  const botLine = (text: string, botId = "a") => ({ ...line({ kind: "bot", botId }, 9), text });

  it("a direct chat hides exact marker lines but keeps replies naming them", () => {
    const transcript = [
      { ...line(user, 1), text: "check in" },
      botLine(" HEARTBEAT_OK\n"),
      botLine("PASS"),
      botLine("It said HEARTBEAT_OK."),
    ];
    const rows = buildChatRenderModel(transcript, new Map()).rows;
    expect(rows.map((row) => ("line" in row ? row.line.text : row.kind))).toEqual([
      "check in",
      "It said HEARTBEAT_OK.",
    ]);
  });

  it("a direct chat hides the completed Codex boundary marker in its unreferenced tail", () => {
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([
        ["a", head("agent-a", [userItem("u", 2), reply("r", 4, "\n\n---\n\nHEARTBEAT_OK")])],
      ]),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["user"]);
  });

  it("a group hides persisted PASS and HEARTBEAT_OK lines, never a user's", () => {
    const transcript = [
      { ...line(user, 1), text: "PASS" },
      botLine("PASS"),
      botLine("HEARTBEAT_OK", "b"),
      botLine("PASS — nothing to add, but see above"),
    ];
    const rows = buildChatRenderModel(transcript, new Map(), { group: true }).rows;
    expect(rows.map((row) => ("line" in row ? row.line.text : row.kind))).toEqual([
      "PASS",
      "PASS — nothing to add, but see above",
    ]);
  });

  it("a direct chat's live HEARTBEAT_OK never shows, even while it is still being typed", () => {
    const streaming = buildChatRenderModel(
      [line(user, 1)],
      new Map([
        ["a", head("agent-a", [tool("t1", 2), reply("r", 3, "HEARTBEAT_")], { turnActive: true })],
      ]),
    ).rows;
    const live = streaming.find((row) => row.kind === "live");
    expect(live?.kind === "live" && live.items.map((item) => item.id)).toEqual(["t1"]);
    // A real reply that merely starts like the marker shows once it says more.
    const real = buildChatRenderModel(
      [line(user, 1)],
      new Map([
        ["a", head("agent-a", [reply("r", 3, "HEARTBEAT_OK is fine")], { turnActive: true })],
      ]),
    ).rows;
    expect(real.find((row) => row.kind === "live")).toMatchObject({ items: [{ id: "r" }] });
  });

  it("a finished silent direct turn leaves none of its tool calls behind", () => {
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([
        ["a", head("agent-a", [userItem("hb", 2), tool("t1", 3), reply("r", 4, "HEARTBEAT_OK")])],
      ]),
    ).rows;
    expect(rows.map((row) => row.kind)).toEqual(["user"]);
  });

  it.each(["PASS", "HEARTBEAT_OK"])(
    "assembles live %s deltas, then releases a longer reply",
    (marker) => {
      let stream = { tail: [] as StreamItem[], head: [] as StreamItem[] };
      const projected = (turnActive: boolean) =>
        buildChatRenderModel(
          [],
          new Map([
            [
              "a",
              {
                ...head("agent-a", stream.tail, { turnActive }),
                streamingItems: stream.head,
              },
            ],
          ]),
        ).rows;
      const send = (text: string) => {
        stream = applyStreamEvent({
          ...stream,
          timestamp: new Date(3),
          event: {
            type: "timeline",
            provider: "codex",
            turnId: "t1",
            item: {
              type: "assistant_message",
              messageId: "message-1",
              text,
            },
          },
        });
      };
      send("\n\n---\n\n");
      for (const char of marker) {
        send(char);
        expect(projected(true)).toMatchObject([{ kind: "live", inProgress: true, items: [] }]);
      }
      expect(stream.head).toMatchObject([
        { messageId: "message-1", text: `\n\n---\n\n${marker}`, turnId: "t1" },
      ]);
      const ended = applyStreamEvent({
        ...stream,
        timestamp: new Date(4),
        event: { type: "turn_completed", provider: "codex", turnId: "t1" },
      });
      expect(buildChatRenderModel([], new Map([["a", head("agent-a", ended.tail)]])).rows).toEqual(
        [],
      );
      send(" means idle; the build is red.");
      expect(projected(true)).toMatchObject([
        { items: [{ text: `\n\n---\n\n${marker} means idle; the build is red.` }] },
      ]);
      stream = applyStreamEvent({
        ...stream,
        timestamp: new Date(4),
        event: { type: "turn_completed", provider: "codex", turnId: "t1" },
      });
      expect(projected(false)).toMatchObject([
        { kind: "live", inProgress: false, items: [{ id: "message-1" }] },
      ]);
    },
  );

  it.each([false, true])(
    "preserves user markers, quotes, code, mentions and longer Bot replies (group=%s)",
    (group) => {
      const kept = [
        "PASS",
        " HEARTBEAT_OK\n",
        "`PASS`",
        "```text\nHEARTBEAT_OK\n```",
        "> HEARTBEAT_OK",
        "@PASS please check",
        "PASSING the tests",
        "HEARTBEAT_OK but one warning",
      ];
      const transcript = [
        ...kept.slice(0, 2).map((text) => Object.assign(line(user, 1), { text })),
        ...kept.slice(2).map((text) => botLine(text)),
        botLine(" PASS \n"),
        botLine(" HEARTBEAT_OK\n"),
        { ...line({ kind: "system" }, 10), text: "PASS" },
      ];
      expect(
        buildChatRenderModel(transcript, new Map(), { group }).rows.map((row) =>
          "line" in row ? row.line.text : row.kind,
        ),
      ).toEqual([...kept, "PASS"]);
      expect(transcript.at(-3)?.text).toBe(" PASS \n");
    },
  );

  it("does not hide one marker message inside a longer contiguous answer or join different turns", () => {
    const items = [
      { ...reply("r1", 2, "PASS"), messageId: "m1", turnId: "t1" },
      { ...reply("r2", 3, "but see this failure"), messageId: "m2", turnId: "t1" },
      { ...reply("r3", 4, "HEARTBEAT_OK"), messageId: "m3", turnId: "t2" },
    ];
    const rows = buildChatRenderModel(
      [],
      new Map([["a", head("agent-a", items, { turnActive: true })]]),
    ).rows;
    expect(rows).toMatchObject([{ items: [{ id: "r1" }, { id: "r2" }] }]);
    const ended = buildChatRenderModel([], new Map([["a", head("agent-a", items)]])).rows;
    expect(ended).toMatchObject([{ items: [{ id: "r1" }, { id: "r2" }] }]);
  });

  it("silent direct completion preserves notifications, failed tools and pending approvals", () => {
    const failed = tool("failed", 3);
    if (failed.kind !== "tool_call") throw new Error("expected tool");
    failed.payload.data.status = "failed";
    failed.payload.data.error = "read failed";
    const notice: StreamItem = {
      kind: "notification",
      sourceType: "error",
      id: "error",
      level: "error",
      message: "provider failed",
      timestamp: new Date(5),
    };
    const rows = buildChatRenderModel(
      [line(user, 1)],
      new Map([
        [
          "a",
          head(
            "agent-a",
            [userItem("u", 2), failed, tool("ok", 3), reply("r", 4, "PASS"), notice],
            { permissions: [permission("agent-a")] },
          ),
        ],
      ]),
    ).rows;
    expect(rows[1]).toMatchObject({
      kind: "live",
      inProgress: false,
      items: [{ id: "failed" }, { id: "error" }],
      permissions: [{ agentId: "agent-a" }],
    });
  });

  it("a canceled incomplete marker is readable and a canceled tool is never hidden by silence", () => {
    const partial = reply("partial", 3, "HEARTBEAT_");
    expect(
      buildChatRenderModel([], new Map([["a", head("agent-a", [partial])]])).rows,
    ).toMatchObject([{ items: [{ text: "HEARTBEAT_" }] }]);
    const canceled = tool("canceled", 2);
    if (canceled.kind !== "tool_call" || canceled.payload.source !== "agent")
      throw new Error("expected agent tool");
    canceled.payload.data.status = "canceled";
    expect(
      buildChatRenderModel([], new Map([["a", head("agent-a", [canceled, reply("r", 3, "PASS")])]]))
        .rows,
    ).toMatchObject([{ items: [{ id: "canceled" }] }]);
  });
});

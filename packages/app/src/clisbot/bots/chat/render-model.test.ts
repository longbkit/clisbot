import { describe, expect, it } from "vitest";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
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

function assistant(id: string, at: number, messageId?: string): StreamItem {
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

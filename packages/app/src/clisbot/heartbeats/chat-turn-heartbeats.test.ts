import { describe, expect, it } from "vitest";
import type { ChatRenderRow } from "@/clisbot/bots/chat/render-model";
import { heartbeatsByTurnLine } from "./chat-turn-heartbeats";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 8, 9, minute)).toISOString();

function userRow(id: string, minute: number): ChatRenderRow {
  const line = { id, seq: minute, at: at(minute), sender: { kind: "user" as const }, text: "" };
  return { kind: "user", key: id, line, opensGroup: true };
}

function botRow(id: string, minute: number, agentId: string, botId = "bot-1"): ChatRenderRow {
  const sender = { kind: "bot" as const, botId };
  const line = { id, seq: minute, at: at(minute), sender, text: "", agentId };
  return { kind: "bot", key: id, line, botId, opensGroup: true };
}

const heartbeat = (id: string, minute: number, agentId = "agent-1") => ({
  id,
  createdAt: at(minute),
  target: { type: "agent", agentId },
});

describe("heartbeatsByTurnLine", () => {
  const rows = [
    userRow("ask", 10),
    botRow("reply", 12, "agent-1"),
    userRow("later", 20),
    botRow("later-reply", 21, "agent-1"),
  ];

  it("puts a heartbeat the Bot made in a turn under that turn's reply", () => {
    expect(heartbeatsByTurnLine(rows, [heartbeat("hb", 11)])).toEqual(new Map([["reply", ["hb"]]]));
  });

  it("in a group, another bot speaking before the reply does not hide the card", () => {
    const group = [
      userRow("ask", 10),
      botRow("other", 11, "agent-2", "bot-2"),
      botRow("reply", 13, "agent-1"),
    ];
    expect(heartbeatsByTurnLine(group, [heartbeat("hb", 12)])).toEqual(
      new Map([["reply", ["hb"]]]),
    );
  });

  it("leaves out one made between turns or for another session", () => {
    const made = [heartbeat("from-app", 15), heartbeat("elsewhere", 11, "agent-2")];
    expect(heartbeatsByTurnLine(rows, made).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { ChatLiveHead } from "./render-model";
import {
  conversationToolDisplay,
  headerToolActivities,
  isToolActivityItem,
  toolActivityOf,
} from "./tool-activity";

type ToolStatus = "running" | "completed" | "failed";

function tool(id: string, at: number, status: ToolStatus = "completed", command = id): StreamItem {
  return {
    kind: "tool_call",
    id,
    turnId: "turn",
    timestamp: new Date(at),
    payload: {
      source: "agent",
      data: {
        provider: "mock",
        callId: id,
        name: "shell",
        status,
        error: status === "failed" ? { message: "exit 1" } : undefined,
        detail: { type: "shell", command },
      },
    },
  } as StreamItem;
}

function text(id: string, at: number): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(at) };
}

function prompt(id: string, at: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: new Date(at) };
}

function head(items: StreamItem[], turnActive = false): ChatLiveHead {
  return { agentId: "agent", items, turnActive, permissions: [] };
}

describe("toolActivityOf", () => {
  it("folds a turn's calls, keeps text out, and follows the latest call", () => {
    const items = [text("intro", 1), tool("a", 2), tool("b", 3, "running")];
    const activity = toolActivityOf(items, true);
    expect(activity?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(activity?.latest.id).toBe("b");
    expect(activity).toMatchObject({ running: true, callCount: 2, failedCount: 0 });
    const next = toolActivityOf([...items.slice(0, 2), tool("b", 3), tool("c", 4)], true);
    expect(next).toMatchObject({ running: false, callCount: 3 });
    expect(next?.latest.id).toBe("c");
    expect(items.filter(isToolActivityItem)).toHaveLength(2);
  });

  it("keeps a failure visible after later calls succeed", () => {
    const activity = toolActivityOf([tool("a", 1, "failed"), tool("b", 2)], false);
    expect(activity).toMatchObject({ failedCount: 1, running: false });
    expect(activity?.latest.id).toBe("b");
  });

  it("is nothing for a turn without tool calls, and never running once the turn ended", () => {
    expect(toolActivityOf([text("only", 1)], true)).toBeNull();
    expect(toolActivityOf([tool("a", 1, "running")], false)?.running).toBe(false);
  });
});

describe("headerToolActivities", () => {
  it("one entry per Bot for its latest turn only, running Bots first, then the most recent", () => {
    const heads = new Map([
      ["done", head([prompt("p1", 1), tool("old", 2), prompt("p2", 3), tool("d1", 9)])],
      ["idle", head([prompt("p1", 1), text("no tools", 2)])],
      ["busy", head([prompt("p1", 1), tool("b1", 5, "running")], true)],
      ["older", head([prompt("p1", 1), tool("o1", 4)])],
    ]);
    const entries = headerToolActivities(heads);
    expect(entries.map((entry) => entry.botId)).toEqual(["busy", "done", "older"]);
    // The previous turn of "done" is not mixed into its latest one.
    expect(entries[1]?.activity.items.map((item) => item.id)).toEqual(["d1"]);
  });
});

describe("conversationToolDisplay", () => {
  const groupRules = (toolCalls?: "expanded" | "header") => ({
    rules: toolCalls ? { display: { toolCalls } } : {},
  });

  it("is collapsed when neither the Bot nor the group set it (older Hosts included)", () => {
    expect(conversationToolDisplay(groupRules(), true, undefined)).toBe("collapsed");
    expect(conversationToolDisplay(null, false, {})).toBe("collapsed");
  });

  it("a direct chat follows its Bot, a group its own setting, never the other's", () => {
    expect(
      conversationToolDisplay(groupRules("expanded"), false, { display: { toolCalls: "header" } }),
    ).toBe("header");
    expect(
      conversationToolDisplay(groupRules("expanded"), true, { display: { toolCalls: "header" } }),
    ).toBe("expanded");
  });
});

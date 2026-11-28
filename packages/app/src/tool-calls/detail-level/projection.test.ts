import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@clisbot/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "./projection";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
        detail,
      },
    },
  };
}

function assistant(id: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function project(input: {
  level: ToolCallDetailLevel;
  tail?: StreamItem[];
  head?: StreamItem[];
  isTurnActive?: boolean;
  preparedHistory?: PreparedToolCallHistory | null;
}) {
  const tail = input.tail ?? [];
  return projectToolCallDetailLevel({
    level: input.level,
    tail,
    head: input.head ?? [],
    preparedHistory: input.preparedHistory ?? prepareToolCallHistory(input.level, tail),
    isTurnActive: input.isTurnActive ?? false,
  });
}

describe("tool call detail-level projection", () => {
  it.each(["detailed", "overview", "summary-with-latest-call"] as const)(
    "keeps pending approval tools out of %s presentation without removing their canonical position",
    (level) => {
      const pending = toolCall(
        "1",
        { type: "plan", text: "Ship it" },
        { name: "ExitPlanMode", status: "running" },
      );
      const followUp = {
        kind: "user_message",
        id: "question",
        text: "What about tests?",
        timestamp: new Date(2),
      } satisfies StreamItem;
      const tail = [pending, followUp];
      expect(project({ level, tail }).tail).toEqual([followUp]);
      expect(tail).toEqual([pending, followUp]);
      const rejected = toolCall("1", { type: "plan", text: "Ship it" }, { name: "plan_approval" });
      expect(project({ level, tail: [rejected, followUp] }).tail).toEqual([rejected, followUp]);
    },
  );

  it("passes detailed timelines through without grouping work", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const prepared = prepareToolCallHistory("detailed", tail);
    const result = project({ level: "detailed", tail, head, preparedHistory: prepared });

    expect(prepared).toBeNull();
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("keeps one stable overview host as a run grows", () => {
    const firstCall = toolCall("1", { type: "shell", command: "one" });
    const secondCall = toolCall("2", { type: "read", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory("overview", []);

    const single = project({
      level: "overview",
      head: [firstCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(single.head).toEqual([firstCall]);
    expect(single.groupsByHostId.size).toBe(0);

    const grouped = project({
      level: "overview",
      head: [firstCall, secondCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(grouped.head).toEqual([
      expect.objectContaining({ id: firstCall.id, timestamp: secondCall.timestamp }),
    ]);
    expect(grouped.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall, secondCall],
      latest: secondCall,
      isSealed: false,
    });
  });

  it("keeps a parallel group loading while any call is still running", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "slow" }, { status: "running" }),
      toolCall("2", { type: "shell", command: "done" }),
    ];
    const result = project({ level: "overview", head: calls, isTurnActive: true });

    expect(result.groupsByHostId.get("1")?.isLoading).toBe(true);
  });

  it("leaves a running lone call visible without an aggregate", () => {
    const call = toolCall("1", { type: "shell", command: "one" }, { status: "running" });
    const result = project({ level: "overview", head: [call], isTurnActive: true });
    expect(result.head).toEqual([call]);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("keeps an active overview group on its latest call until a visible boundary arrives", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }),
    ];
    const prepared = prepareToolCallHistory("overview", []);
    const active = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const activeGroup = active.groupsByHostId.get("1");

    expect(activeGroup).toMatchObject({
      mode: "overview",
      run: { id: "1", latest: calls[3], isSealed: false },
    });
    const boundary = assistant("answer");
    const sealed = project({
      level: "overview",
      head: [...calls, boundary],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(sealed.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { latest: calls[3], isSealed: true },
      summary: { editedFileCount: 1, readFileCount: 2, commandCount: 1 },
    });
  });

  it("keeps a running overview group live before the agent lifecycle catches up", () => {
    const calls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }, { status: "running" }),
    );

    const result = project({
      level: "overview",
      tail: calls,
      isTurnActive: false,
    });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      run: { latest: calls[3], isSealed: false },
      isLoading: true,
      summary: { commandCount: 4 },
    });
  });

  it("seals the trailing overview group only when the turn ends", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory("overview", []);

    const betweenCalls = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const nextCall = toolCall("5", { type: "read", filePath: "/repo/a.ts" });
    const continued = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const ended = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: false,
      preparedHistory: prepared,
    });

    expect(betweenCalls.groupsByHostId.get("1")?.run.isSealed).toBe(false);
    expect(continued.groupsByHostId.get("1")?.run).toMatchObject({
      latest: nextCall,
      isSealed: false,
    });
    expect(ended.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("builds overview summaries without category-specific presentation data", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/src/b.ts" }),
      toolCall("3", { type: "shell", command: "npm test" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }, { status: "failed" }),
    ];

    const overview = project({ level: "overview", head: calls });

    expect(overview.groupsByHostId.get("1")).toEqual({
      mode: "overview",
      run: expect.any(Object),
      isLoading: false,
      summary: {
        thoughtCount: 0,
        editedFileCount: 1,
        commandCount: 1,
        readFileCount: 2,
        searchCount: 0,
        otherToolCount: 0,
        clisbotActions: {},
      },
    });
  });

  it("distinguishes reads, searches, and other tools in overview", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "clisbot", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 1,
        otherToolCount: 2,
      },
    });
  });

  it("counts unique edited files and every shell command in overview", () => {
    const calls = [
      toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "write", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "shell", command: "npm test" }),
      toolCall("5", { type: "shell", command: "npm run lint" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 2,
        commandCount: 2,
        readFileCount: 1,
        otherToolCount: 0,
      },
    });
  });

  it("counts Clisbot calls separately from other tools", () => {
    const calls = [
      toolCall(
        "1",
        { type: "unknown", input: null, output: null },
        { name: "clisbot.list_agents" },
      ),
      toolCall(
        "2",
        { type: "unknown", input: null, output: null },
        { name: "mcp__clisbot__list_worktrees" },
      ),
      toolCall("3", { type: "fetch", url: "https://clisbot.com" }),
      toolCall("4", { type: "fetch", url: "https://github.com/getpaseo" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { otherToolCount: 2, clisbotActions: { "Listed agents": 1, "List worktrees": 1 } },
    });
  });

  it("classifies direct Brave search and Clisbot runtime tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = [
      toolCall("1", unknownDetail, { name: "brave-search_brave_web_search" }),
      toolCall("2", unknownDetail, { name: "brave-search_brave_llm_context" }),
      toolCall("3", unknownDetail, { name: "clisbot_list_providers" }),
      toolCall("4", unknownDetail, { name: "clisbot_list_worktrees" }),
      toolCall("5", unknownDetail, { name: "clisbot_list_worktrees" }),
      toolCall("6", unknownDetail, { name: "mcp__exa__web_search" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        searchCount: 3,
        otherToolCount: 0,
        clisbotActions: { "Listed providers": 1, "List worktrees": 2 },
      },
    });
  });

  it("reuses prepared history and sealed group models across live-head updates", () => {
    const historicalCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const tail = [...historicalCalls, assistant("boundary")];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: historicalCalls[3]?.timestamp }),
      tail[4],
    ]);
    const first = project({
      level: "overview",
      tail,
      head: [toolCall("5", { type: "read", filePath: "/repo/a.ts" })],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: [
        toolCall("5", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("6", { type: "read", filePath: "/repo/b.ts" }),
      ],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(second.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
    expect(second.groupsByHostId.get("5")?.run.calls).toHaveLength(2);
  });

  it("preserves projected history identity during assistant-only head updates", () => {
    const trailingCalls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
    ];
    const tail = [assistant("before"), ...trailingCalls];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }

    const firstHead = [assistant("answer")];
    const secondHead = [{ ...firstHead[0], text: "answer grows" }];
    const first = project({
      level: "overview",
      tail,
      head: firstHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: secondHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(second.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
  });

  it("forms one group across the retained-history and live-head boundary", () => {
    const tail = [
      assistant("before"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }, { status: "running" }),
    ];

    const result = project({ level: "overview", tail, head, isTurnActive: true });

    expect(result.tail).toEqual([
      tail[0],
      expect.objectContaining({ id: "1", timestamp: tail[2]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run).toMatchObject({
      calls: [...tail.slice(1), ...head],
      latest: head[1],
      isSealed: false,
    });
    expect(result.historyGroupUpdatesByHostId.get("1")).toBe(result.groupsByHostId.get("1"));
  });

  it("keeps a trailing history-only group in the retained segment", () => {
    const tail = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));

    const result = project({ level: "overview", tail, isTurnActive: false });

    expect(result.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: tail[3]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("hosts single calls while leaving plans and spoken messages ungrouped", () => {
    const singleCall = toolCall("1", { type: "shell", command: "one" });
    const plan = toolCall("2", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "3",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = project({ level: "overview", head: [singleCall, plan, speak] });

    expect(result.head).toEqual([singleCall, plan, speak]);
    expect(result.groupsByHostId.size).toBe(0);
  });
});

it("keeps a heartbeat trigger visible outside grouped work", () => {
  const trigger = toolCall(
    "1",
    { type: "plain_text", text: "Check progress" },
    { name: "heartbeat" },
  );
  const work = toolCall("2", { type: "shell", command: "pwd" });
  const result = project({ level: "overview", tail: [trigger, work] });
  expect(result.tail.map((item) => item.id)).toEqual(["1", "2"]);
  expect(result.groupsByHostId.has("1")).toBe(false);
});

it("does not merge tools from different canonical turns", () => {
  const first = toolCall("1", { type: "shell", command: "pwd" });
  first.turnId = "first";
  const second = toolCall("2", { type: "shell", command: "ls" });
  second.turnId = "second";
  const result = project({ level: "overview", tail: [first, second] });
  expect(result.tail.map((item) => item.id)).toEqual(["1", "2"]);
});

it.each([false, true])(
  "handles streaming reasoning across retained history (Expand thinking %s)",
  (autoExpandReasoning) => {
    const call = { ...toolCall("1", { type: "shell", command: "echo ok" }), turnId: "run" };
    const thought: StreamItem = {
      kind: "thought",
      id: "reasoning",
      text: "Checking",
      status: "loading",
      timestamp: new Date(),
      turnId: "run",
    };
    const tail = [call];
    const result = project({
      level: "overview",
      tail,
      head: [thought],
      isTurnActive: true,
      preparedHistory: prepareToolCallHistory("overview", tail, autoExpandReasoning),
    });
    expect(result.head).toEqual(autoExpandReasoning ? [thought] : []);
    expect(result.groupsByHostId.get(call.id)?.run.calls).toEqual(
      autoExpandReasoning ? undefined : [call, thought],
    );
    const group = result.groupsByHostId.get(call.id);
    expect(group?.mode === "overview" ? group.summary : undefined).toEqual(
      autoExpandReasoning
        ? undefined
        : expect.objectContaining({
            commandCount: 1,
            otherToolCount: 0,
            thoughtCount: 1,
          }),
    );
  },
);

it("turns a retained lone call into a group without replacing its row key", () => {
  const first = toolCall("1", { type: "shell", command: "one" });
  const second = toolCall("2", { type: "shell", command: "two" });
  const tail = [assistant("before"), first];
  const preparedHistory = prepareToolCallHistory("overview", tail);
  const single = project({ level: "overview", tail, preparedHistory, isTurnActive: true });
  const grouped = project({
    level: "overview",
    tail,
    head: [second],
    preparedHistory,
    isTurnActive: true,
  });
  expect(single.groupsByHostId.size).toBe(0);
  expect(single.tail).toBe(tail);
  expect(grouped.tail).toBe(single.tail);
  expect(grouped.head).toEqual([]);
  expect(grouped.groupsByHostId.get(first.id)?.run.calls).toEqual([first, second]);
  expect(grouped.historyGroupUpdatesByHostId.get(first.id)).toBe(
    grouped.groupsByHostId.get(first.id),
  );
});

it("shows one thought as itself until another groupable item arrives", () => {
  const thought: StreamItem = {
    kind: "thought",
    id: "thought",
    text: "Checking",
    status: "ready",
    timestamp: new Date(0),
  };
  const single = project({ level: "overview", tail: [thought] });
  expect(single.tail).toEqual([thought]);
  expect(single.groupsByHostId.size).toBe(0);
  const grouped = project({
    level: "overview",
    tail: [thought, toolCall("1", { type: "shell", command: "one" })],
  });
  expect(grouped.tail.map((item) => item.id)).toEqual([thought.id]);
  expect(grouped.groupsByHostId.get(thought.id)?.run.calls).toHaveLength(2);
});

describe("a lone tool call", () => {
  const call = toolCall("1", { type: "shell", command: "npm test" });
  const reply = assistant("done");

  interface Rows {
    tail?: StreamItem[];
    head?: StreamItem[];
    isTurnActive?: boolean;
  }
  const retained: Rows = { tail: [call, reply] };
  const streaming: Rows = { head: [call], isTurnActive: true };

  it.each([
    ["retained", retained],
    ["streaming", streaming],
  ])("is a one-item latest-call badge in latest-call mode (%s)", (_, rows) => {
    const result = project({ level: "summary-with-latest-call", ...rows });
    const group = result.groupsByHostId.get(call.id);
    expect(group).toMatchObject({
      mode: "summary-with-latest-call",
      run: { calls: [call], latest: call },
      latestToolCall: call,
      toolCallCount: 1,
    });
    // The badge reuses the call's row key, so nothing else in the timeline moves.
    expect([...result.tail, ...result.head].map((item) => item.id)).toEqual(
      [...(rows.tail ?? []), ...(rows.head ?? [])].map((item) => item.id),
    );
  });

  it.each(["detailed", "overview"] as const)(
    "keeps its own row in %s mode, as upstream designed",
    (level) => {
      for (const rows of [retained, streaming]) {
        const result = project({ level, ...rows });
        expect(result.groupsByHostId.size).toBe(0);
        expect([...result.tail, ...result.head]).toContain(call);
      }
    },
  );

  it("stays a reasoning row when it is reasoning, even in latest-call mode", () => {
    const thought = {
      kind: "thought",
      status: "ready",
      id: "reasoning",
      text: "thinking",
      timestamp: new Date(),
    } satisfies StreamItem;
    const result = project({ level: "summary-with-latest-call", tail: [thought, reply] });
    expect(result.groupsByHostId.size).toBe(0);
  });
});

describe("summary with latest call", () => {
  const level = "summary-with-latest-call" as const;
  it("replaces the latest preview while retaining history and stable host across live updates", () => {
    const first = toolCall("1", { type: "shell", command: "first" });
    const running = toolCall(
      "2",
      { type: "shell", command: "long command" },
      { status: "running" },
    );
    const single = project({ level, tail: [first], isTurnActive: true });
    expect(single.groupsByHostId.get("1")).toMatchObject({
      mode: level,
      run: { calls: [first], latest: first },
      latestToolCall: first,
      toolCallCount: 1,
      isLoading: false,
      failedCount: 0,
    });
    const live = project({ level, tail: [first], head: [running], isTurnActive: true });
    expect(live.tail.map((item) => item.id)).toEqual(["1"]);
    expect(live.head).toEqual([]);
    expect(live.historyGroupUpdatesByHostId.get("1")).toMatchObject({
      mode: level,
      run: { calls: [first, running], latest: running, isSealed: false },
      latestToolCall: running,
      toolCallCount: 2,
      isLoading: true,
      failedCount: 0,
    });
    const failed = toolCall("2", { type: "shell", command: "long command" }, { status: "failed" });
    const ended = project({ level, tail: [first, failed] });
    expect(ended.groupsByHostId.get("1")).toMatchObject({
      run: { calls: [first, failed], latest: failed, isSealed: true },
      isLoading: false,
      failedCount: 1,
    });
  });
  it("uses exactly the overview grouping and keeps non-tool content and turn boundaries in place", () => {
    const first = toolCall("1", { type: "shell", command: "first" });
    const second = toolCall("2", { type: "shell", command: "second" });
    const text = assistant("intermediate text");
    const reasoning = {
      kind: "thought",
      status: "ready",
      id: "reasoning",
      text: "thinking",
      timestamp: new Date(),
    } satisfies StreamItem;
    const prompt = {
      kind: "user_message",
      id: "prompt",
      text: "next turn",
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          title: "Attached context",
          text: "Preserve this attachment",
        },
      ],
      timestamp: new Date(),
    } satisfies StreamItem;
    const later = toolCall("3", { type: "shell", command: "next-turn" });
    const tail = [first, second, text, reasoning, prompt, later];
    const overview = project({ level: "overview", tail });
    const latest = project({ level, tail });
    expect(latest.tail).toEqual(overview.tail);
    expect(latest.head).toEqual(overview.head);
    // Same rows; latest-call additionally badges the lone call that overview leaves as a row.
    expect(overview.groupsByHostId.has(later.id)).toBe(false);
    expect(latest.groupsByHostId.get(later.id)?.run.calls).toEqual([later]);
    expect(latest.groupsByHostId.size).toBe(overview.groupsByHostId.size + 1);
    expect(latest.tail).toEqual([
      expect.objectContaining({ id: first.id }),
      text,
      reasoning,
      prompt,
      later,
    ]);
    expect(latest.groupsByHostId.get(first.id)?.run).toEqual(
      overview.groupsByHostId.get(first.id)?.run,
    );
  });
  it("previews the latest tool call, not reasoning folded after it", () => {
    const call = toolCall("1", { type: "shell", command: "npm test" });
    const thought = {
      kind: "thought",
      status: "loading",
      id: "reasoning",
      text: "thinking",
      timestamp: new Date(),
    } satisfies StreamItem;
    const group = project({
      level,
      tail: [call],
      head: [thought],
      isTurnActive: true,
    }).historyGroupUpdatesByHostId.get(call.id);
    expect(group).toMatchObject({
      mode: level,
      run: { latest: thought },
      latestToolCall: call,
      toolCallCount: 1,
      isLoading: true,
    });
    const ready = { ...thought, status: "ready" } as const;
    const reasoningOnly = project({ level, tail: [ready, { ...ready, id: "reasoning-2" }] });
    expect(reasoningOnly.groupsByHostId.get(thought.id)).toMatchObject({
      latestToolCall: null,
      toolCallCount: 0,
      isLoading: false,
    });
  });
  it("reports errors and loading independently when parallel calls finish out of order", () => {
    const running = toolCall("1", { type: "shell", command: "slow" }, { status: "running" });
    const failed = toolCall("2", { type: "read", filePath: "/repo/missing" }, { status: "failed" });
    expect(project({ level, head: [running, failed] }).groupsByHostId.get("1")).toMatchObject({
      isLoading: true,
      failedCount: 1,
      run: { latest: failed },
    });
  });
});

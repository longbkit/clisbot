import { describe, expect, it } from "vitest";
import { CodexBackgroundWork } from "./codex-background-work.js";

function commandItem(id: string, status: string) {
  return { threadId: "t1", turnId: "u1", item: { type: "commandExecution", id, status } };
}

describe("CodexBackgroundWork", () => {
  it("is idle with nothing observed", () => {
    expect(new CodexBackgroundWork().isIdle).toBe(true);
  });

  it("holds the session while a command outlives its turn", () => {
    const work = new CodexBackgroundWork();
    work.observe("item/started", commandItem("call_1", "inProgress"));
    work.observe("turn/completed", { threadId: "t1", turn: { id: "u1", status: "completed" } });
    expect(work.isIdle).toBe(false);

    work.observe("item/completed", commandItem("call_1", "completed"));
    expect(work.isIdle).toBe(true);
  });

  it("ignores commands that never ran and other item types", () => {
    const work = new CodexBackgroundWork();
    work.observe("item/started", commandItem("call_1", "declined"));
    work.observe("item/started", { item: { type: "agentMessage", id: "m1" } });
    expect(work.isIdle).toBe(true);
  });

  it("tracks legacy exec command events by call id", () => {
    const work = new CodexBackgroundWork();
    work.observe("codex/event/exec_command_begin", {
      msg: { type: "exec_command_begin", call_id: "c1" },
    });
    expect(work.isIdle).toBe(false);
    work.observe("codex/event/exec_command_end", {
      msg: { type: "exec_command_end", call_id: "c1" },
    });
    expect(work.isIdle).toBe(true);
  });

  it("holds the session while a goal is active", () => {
    const work = new CodexBackgroundWork();
    work.observe("thread/goal/updated", { threadId: "t1", goal: { status: "active" } });
    expect(work.isIdle).toBe(false);
    work.observe("thread/goal/updated", { threadId: "t1", goal: { status: "paused" } });
    expect(work.isIdle).toBe(true);

    work.observeGoalStatus("t1", "active");
    expect(work.isIdle).toBe(false);
    work.observe("thread/goal/cleared", { threadId: "t1" });
    expect(work.isIdle).toBe(true);
  });

  it("holds the session while any thread is active", () => {
    const work = new CodexBackgroundWork();
    work.observe("thread/status/changed", {
      threadId: "child",
      status: { type: "active", activeFlags: [] },
    });
    expect(work.isIdle).toBe(false);
    work.observe("thread/status/changed", { threadId: "child", status: { type: "idle" } });
    expect(work.isIdle).toBe(true);

    work.observe("thread/status/changed", { threadId: "child", status: { type: "active" } });
    work.observe("thread/closed", { threadId: "child" });
    expect(work.isIdle).toBe(true);
  });

  it("starts over when the app-server is replaced", () => {
    const work = new CodexBackgroundWork();
    work.observe("item/started", commandItem("call_1", "inProgress"));
    work.observe("thread/goal/updated", { threadId: "t1", goal: { status: "active" } });
    work.reset();
    expect(work.isIdle).toBe(true);
  });
});

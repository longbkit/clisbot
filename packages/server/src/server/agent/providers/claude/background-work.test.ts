import { describe, expect, it } from "vitest";
import { ClaudeBackgroundWork } from "./background-work.js";

function stopHook(backgroundTasks: unknown[], sessionCrons: unknown[]) {
  return {
    hook_event_name: "Stop",
    background_tasks: backgroundTasks,
    session_crons: sessionCrons,
  };
}

function tasksChanged(taskIds: string[]) {
  return {
    type: "system",
    subtype: "background_tasks_changed",
    tasks: taskIds.map((task_id) => ({ task_id, task_type: "local_bash", description: "x" })),
  };
}

describe("ClaudeBackgroundWork", () => {
  it("is idle in a process that has not run a turn", () => {
    expect(new ClaudeBackgroundWork().isIdle).toBe(true);
  });

  it("is not idle after a turn starts until its Stop hook reports", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    expect(work.isIdle).toBe(false);
    work.observeStopHook(stopHook([], []));
    expect(work.isIdle).toBe(true);
  });

  it("holds the session while a background shell runs past its turn", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeMessage(tasksChanged(["bwnax3bqi"]));
    work.observeStopHook(
      stopHook([{ id: "bwnax3bqi", type: "shell", status: "running", command: "sleep 40" }], []),
    );
    expect(work.isIdle).toBe(false);

    work.observeMessage(tasksChanged([]));
    expect(work.isIdle).toBe(true);
  });

  it("holds the session while a session cron is scheduled", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeStopHook(stopHook([], [{ id: "03658a25", schedule: "*/30 * * * *" }]));
    expect(work.isIdle).toBe(false);

    work.observeTurnStarted();
    work.observeStopHook(stopHook([], []));
    expect(work.isIdle).toBe(true);
  });

  it("ignores finished tasks in the Stop hook", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeStopHook(stopHook([{ id: "a", status: "completed" }], []));
    expect(work.isIdle).toBe(true);
  });

  it("does not trust a turn that ended without a Stop hook", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeStopHook(stopHook([], []));
    work.observeTurnStarted();
    expect(work.isIdle).toBe(false);
  });

  it("ignores Stop input without both lists", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeStopHook({ hook_event_name: "Stop", background_tasks: [] });
    expect(work.isIdle).toBe(false);
  });

  it("starts over when the process is replaced", () => {
    const work = new ClaudeBackgroundWork();
    work.observeTurnStarted();
    work.observeMessage(tasksChanged(["a"]));
    work.observeStopHook(stopHook([{ id: "a", status: "running" }], [{ id: "c" }]));
    work.reset();
    expect(work.isIdle).toBe(true);
  });
});

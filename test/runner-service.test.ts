import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "../src/agents/session-state.ts";
import { RunnerService } from "../src/agents/runner-service.ts";
import type { TmuxClient } from "../src/runners/tmux/client.ts";

describe("RunnerService recovery classification", () => {
  test("treats lost tmux targets as recoverable mid-run faults", () => {
    const runner = new RunnerService(
      {} as any,
      {} as TmuxClient,
      {} as AgentSessionState,
      (() => ({})) as any,
    );

    expect(runner.canRecoverMidRun(new Error("no such pane: %1"))).toBe(true);
    expect(runner.canRecoverMidRun(new Error("can't find window: 1"))).toBe(true);
    expect(runner.canRecoverMidRun(new Error("tmux pane state unavailable"))).toBe(true);
  });
});

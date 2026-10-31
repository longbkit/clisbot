import { describe, expect, it } from "vitest";
import { createPerfCollector, formatPerfLine } from "./collector";

describe("perf collector", () => {
  it("aggregates one window and starts the next one empty", () => {
    let now = 1_000;
    const collector = createPerfCollector({ now: () => now });

    collector.message("agent_update", 400, 2);
    collector.message("agent_update", 600, 3);
    collector.message("pong", 20, 0.5);
    collector.storeCommit("session", "setAgents");
    collector.storeCommit("session", "setAgents");
    collector.storeCommit("panel", null);
    collector.render("NavHome", 4);
    collector.render("HomeRow:host-1:agent-7", 1);
    collector.render("HomeRow:host-2:agent-9", 2);
    collector.timer("interval:5000ms", 1.5);
    collector.timer("interval:5000ms", 0.5);
    collector.lag(120);
    collector.lag(40);
    now = 11_000;

    expect(collector.flush()).toEqual({
      windowMs: 10_000,
      messages: {
        agent_update: { count: 2, bytes: 1_000, ms: 5 },
        pong: { count: 1, bytes: 20, ms: 0.5 },
      },
      stores: { "session.setAgents": 2, "panel.set": 1 },
      renders: {
        NavHome: { count: 1, ms: 4 },
        HomeRow: { count: 2, ms: 3 },
      },
      timers: { "interval:5000ms": { count: 2, ms: 2 } },
      longestTaskMs: 120,
    });
    now = 21_000;
    expect(collector.flush()).toEqual({
      windowMs: 10_000,
      messages: {},
      stores: {},
      renders: {},
      timers: {},
      longestTaskMs: 0,
    });
  });

  it("caps distinct keys so dynamic names cannot grow a window without bound", () => {
    const collector = createPerfCollector({ now: () => 0, maxKeys: 2 });
    collector.message("a", 1, 1);
    collector.message("b", 1, 1);
    collector.message("c", 1, 1);
    collector.message("a", 1, 1);

    expect(collector.flush().messages).toEqual({
      a: { count: 2, bytes: 2, ms: 2 },
      b: { count: 1, bytes: 1, ms: 1 },
      other: { count: 1, bytes: 1, ms: 1 },
    });
  });

  it("formats one console line with rounded durations", () => {
    const line = formatPerfLine({
      windowMs: 10_000,
      messages: { agent_update: { count: 2, bytes: 1_000, ms: 5.126 } },
      stores: {},
      renders: {},
      timers: {},
      longestTaskMs: 120.44,
    });

    expect(line).toBe(
      '[clisbot:perf] {"windowMs":10000,"messages":{"agent_update":{"count":2,"bytes":1000,"ms":5.1}},"stores":{},"renders":{},"timers":{},"longestTaskMs":120.4}',
    );
  });
});

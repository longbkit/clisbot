import { describe, expect, it } from "vitest";
import pino from "pino";
import { ScheduleSession } from "./schedule-session.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { ScheduleService } from "../../schedule/service.js";

function makeSession(schedule: { [K in keyof ScheduleService]?: unknown }) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new ScheduleSession({
    host: { emit: (message) => emitted.push(message) },
    scheduleService: createStub<ScheduleService>(schedule),
    logger: pino({ level: "silent" }),
  });
  return { session, emitted };
}

describe("ScheduleSession", () => {
  it("schedule/create returns a summary with the runs stripped", async () => {
    const stored = {
      id: "s1",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          status: "running" as const,
          agentId: null,
          output: null,
          error: null,
        },
      ],
    };
    const { session, emitted } = makeSession({ create: async () => stored });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc1",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      maxRuns: 5,
      target: { type: "agent", agentId: "a" },
    });

    const response = findByType(emitted, "schedule/create/response");
    expect(response?.payload.schedule).toBeDefined();
    expect(response?.payload.schedule).not.toHaveProperty("runs");
    expect(response?.payload.schedule.id).toBe("s1");
  });

  it("schedule/create remaps a self target to an agent target before creating", async () => {
    let received: Parameters<ScheduleService["create"]>[0] | undefined;
    const stored = {
      id: "s2",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { session, emitted } = makeSession({
      create: async (input: Parameters<ScheduleService["create"]>[0]) => {
        received = input;
        return stored;
      },
    });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc2",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      maxRuns: 5,
      target: { type: "self", agentId: "agent-9" },
    });

    expect(received?.target).toEqual({ type: "agent", agentId: "agent-9" });
    expect(findByType(emitted, "schedule/create/response")?.payload.error).toBeNull();
  });

  it("schedule/create refuses a schedule that repeats within the day without max runs", async () => {
    let created = false;
    const { session, emitted } = makeSession({
      create: async () => {
        created = true;
        throw new Error("not reached");
      },
    });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc3",
      prompt: "p",
      cadence: { type: "cron", expression: "*/5 * * * *" },
      target: { type: "agent", agentId: "a" },
    });

    expect(created).toBe(false);
    expect(findByType(emitted, "rpc_error")?.payload.error).toMatch(/set Max runs/);
  });

  describe("schedule/update and Max runs", () => {
    const older = {
      id: "s4",
      name: null,
      prompt: "p",
      cadence: { type: "cron" as const, expression: "*/5 * * * *" },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };

    function updateSession() {
      const updates: unknown[] = [];
      const made = makeSession({
        inspect: async () => older,
        update: async (input: unknown) => {
          updates.push(input);
          return older;
        },
      });
      return { ...made, updates };
    }

    it("renames a schedule stored without Max runs", async () => {
      const { session, emitted, updates } = updateSession();
      await session.handleScheduleUpdateRequest({
        type: "schedule/update",
        requestId: "su1",
        scheduleId: "s4",
        name: "Renamed",
      });
      expect(updates).toEqual([{ id: "s4", name: "Renamed" }]);
      expect(findByType(emitted, "rpc_error")).toBeUndefined();
    });

    it("refuses a new cadence within the day when no Max runs is stored", async () => {
      const { session, emitted, updates } = updateSession();
      await session.handleScheduleUpdateRequest({
        type: "schedule/update",
        requestId: "su2",
        scheduleId: "s4",
        cadence: { type: "cron", expression: "*/10 * * * *" },
      });
      expect(updates).toEqual([]);
      expect(findByType(emitted, "rpc_error")?.payload.error).toMatch(/set Max runs/);
    });

    it("accepts the cadence once Max runs comes with it", async () => {
      const { session, updates } = updateSession();
      await session.handleScheduleUpdateRequest({
        type: "schedule/update",
        requestId: "su3",
        scheduleId: "s4",
        cadence: { type: "cron", expression: "*/10 * * * *" },
        maxRuns: 6,
      });
      expect(updates).toHaveLength(1);
    });
  });
});

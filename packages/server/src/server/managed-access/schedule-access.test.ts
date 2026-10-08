import { describe, expect, test } from "vitest";
import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import {
  allowsScheduleInbound,
  filterVisibleSchedules,
  type ScheduleAccessResolver,
} from "./schedule-access.js";

const ALLOWED_AGENT = "11111111-1111-4111-8111-111111111111";
const OTHER_AGENT = "22222222-2222-4222-8222-222222222222";

function schedule(id: string, target: StoredSchedule["target"]): StoredSchedule {
  return {
    id,
    name: null,
    prompt: "check",
    cadence: { type: "every", everyMs: 60_000 },
    target,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [],
  };
}

const stored = new Map<string, StoredSchedule>([
  ["mine", schedule("mine", { type: "agent", agentId: ALLOWED_AGENT })],
  ["theirs", schedule("theirs", { type: "agent", agentId: OTHER_AGENT })],
  [
    "in-folder",
    schedule("in-folder", { type: "new-agent", config: { provider: "claude", cwd: "/work/a" } }),
  ],
]);

const resolver: ScheduleAccessResolver = {
  allowsAgent: async (agentId, privilege) =>
    (privilege === "schedule.manage" || privilege === "agent.interact") &&
    agentId === ALLOWED_AGENT,
  allowsCwd: async (cwd, privilege) => privilege === "schedule.manage" && cwd.startsWith("/work/a"),
  allowsWorkspace: async (workspaceId, privilege) =>
    privilege === "schedule.manage" && workspaceId === "wks_a",
  allowsChatSend: (chatId) => chatId === "chat_mine",
  allowsLaunch: async (config) => config.provider === "claude" && config.model !== "opus-max",
  findSchedule: async (id) => stored.get(id) ?? null,
};

describe("schedule access for a Project-scoped session", () => {
  test("create needs schedule.manage where the schedule runs", async () => {
    const heartbeat = (agentId: string) =>
      allowsScheduleInbound(
        {
          type: "schedule/create",
          requestId: "r",
          prompt: "p",
          cadence: { type: "every", everyMs: 60_000 },
          target: { type: "agent", agentId },
        },
        resolver,
      );
    expect(await heartbeat(ALLOWED_AGENT)).toBe(true);
    expect(await heartbeat(OTHER_AGENT)).toBe(false);

    const inWorkspace = (workspaceId: string) =>
      allowsScheduleInbound(
        {
          type: "schedule/create",
          requestId: "r",
          prompt: "p",
          cadence: { type: "every", everyMs: 60_000 },
          target: {
            type: "new-agent",
            config: { provider: "claude", cwd: "/work/a", workspaceId },
          },
        },
        resolver,
      );
    expect(await inWorkspace("wks_a")).toBe(true);
    expect(await inWorkspace("wks_b")).toBe(false);
  });

  test("operations on an existing schedule follow that schedule's Project", async () => {
    const pause = (scheduleId: string) =>
      allowsScheduleInbound({ type: "schedule/pause", requestId: "r", scheduleId }, resolver);
    expect(await pause("mine")).toBe(true);
    expect(await pause("theirs")).toBe(false);
    expect(await pause("missing")).toBe(false);
  });

  test("an update cannot move a schedule out of reach", async () => {
    const update = (cwd: string) =>
      allowsScheduleInbound(
        {
          type: "schedule/update",
          requestId: "r",
          scheduleId: "in-folder",
          newAgentConfig: { cwd },
        },
        resolver,
      );
    expect(await update("/work/a/sub")).toBe(true);
    expect(await update("/work/b")).toBe(false);
  });

  test("loop stubs are refused and other messages are not settled here", async () => {
    expect(await allowsScheduleInbound({ type: "loop/list", requestId: "r" }, resolver)).toBe(
      false,
    );
    expect(await allowsScheduleInbound({ type: "ping", requestId: "r" } as never, resolver)).toBe(
      undefined,
    );
  });

  test("lists keep only schedules of granted Projects", async () => {
    const visible = await filterVisibleSchedules([...stored.values()], resolver);
    expect(visible.map((entry) => entry.id)).toEqual(["mine", "in-folder"]);
  });

  test("anything that makes a schedule run needs what the run does", async () => {
    const create = (target: StoredSchedule["target"]) =>
      allowsScheduleInbound(
        {
          type: "schedule/create",
          requestId: "r",
          prompt: "p",
          cadence: { type: "every", everyMs: 60_000 },
          target,
        },
        resolver,
      );
    // A launch the caller could not start themselves is refused, though the folder is theirs.
    expect(
      await create({
        type: "new-agent",
        config: { provider: "claude", cwd: "/work/a", model: "opus-max" },
      }),
    ).toBe(false);
    // A heartbeat into someone else's Chat is refused, though the session is theirs.
    expect(await create({ type: "agent", agentId: ALLOWED_AGENT, chatId: "chat_mine" })).toBe(true);
    expect(await create({ type: "agent", agentId: ALLOWED_AGENT, chatId: "chat_other" })).toBe(
      false,
    );

    // An update is checked as the schedule will run after it.
    const update = await allowsScheduleInbound(
      {
        type: "schedule/update",
        requestId: "r",
        scheduleId: "in-folder",
        newAgentConfig: { model: "opus-max" },
      },
      resolver,
    );
    expect(update).toBe(false);
  });
});

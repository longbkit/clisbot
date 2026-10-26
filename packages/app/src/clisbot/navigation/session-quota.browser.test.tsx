import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { UsageReportEntry } from "@/usage/types";
import { SessionQuota } from "./session-quota";

type Reply = UsageReportEntry[] | Error;
type Turn = { phase: "idle" } | { phase: "open" };
const SERVER = "host-1";
const AGENT = "agent-1";
const OPENED = { serverId: SERVER, agentId: AGENT };

const world = vi.hoisted(() => ({
  visible: true,
  visibleListeners: new Set<() => void>(),
  reply: [] as unknown as Reply | (() => Reply),
  requests: [] as Array<{ agentId?: string; forceRefresh?: boolean; at: number }>,
}));

vi.mock("react-native-unistyles", async () => {
  const { StyleSheet } = await import("react-native");
  const { lightTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function" ? (styles as (t: typeof lightTheme) => T)(lightTheme) : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
  };
});
vi.mock("@/usage/display", () => ({
  useUsageDisplay: () => ({ display: { displayAs: "used" } }),
}));
vi.mock("@/hooks/use-app-visible", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppVisible: () =>
      useSyncExternalStore(
        (listener) => {
          world.visibleListeners.add(listener);
          return () => world.visibleListeners.delete(listener);
        },
        () => world.visible,
      ),
  };
});
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
  useHostRuntimeConnectionStatuses: () => new Map(),
  useHosts: () => [],
  getHostRuntimeStore: () => ({
    getClient: () => ({
      async listUsageReports(
        request: { agentId?: string; forceRefresh?: boolean },
        onReport: (report: UsageReportEntry) => void,
      ) {
        world.requests.push({ ...request, at: Date.now() });
        const reply = typeof world.reply === "function" ? world.reply() : world.reply;
        if (reply instanceof Error) throw reply;
        for (const report of reply) onReport(report);
        return { reports: reply };
      },
    }),
  }),
}));
vi.mock("@/stores/session-store", async () => {
  const { create } = await import("zustand");
  const agent = { turn: { phase: "idle" } };
  const useSessionStore = create(() => ({
    sessions: {
      "host-1": {
        serverInfo: { features: { usageSources: true } },
        agents: new Map([["agent-1", agent]]),
      },
    },
  }));
  return { useSessionStore };
});

const t0 = Date.parse("2026-10-27T10:00:00Z");
const sinceStart = () => Date.now() - t0;
const minutes = (count: number) => count * 60_000;

/** One Claude report: the hour window at `used` percent, read at `readAt` (ms after the start). */
function claude(used: number, readAt = sinceStart()): UsageReportEntry {
  const fetchedAt = new Date(t0 + readAt).toISOString();
  return {
    id: "claude:me",
    sourceId: "claude",
    sourceLabel: "Claude",
    account: {},
    fetchedAt,
    successfulAt: fetchedAt,
    report: {
      status: "available",
      windows: [
        {
          id: "five_hour",
          label: "Session",
          usedPct: used,
          resetsAt: new Date(t0 + readAt + minutes(90)).toISOString(),
        },
      ],
    },
  } as UsageReportEntry;
}

/** What the daemon sends when the provider refused: an error entry, with its last good read. */
function refused(lastGood: UsageReportEntry): UsageReportEntry {
  return {
    ...lastGood,
    fetchedAt: new Date(Date.now()).toISOString(),
    successfulAt: undefined,
    report: { status: "error", error: "Rate limited by Claude. Try again in 20m." },
    lastSuccessful: {
      fetchedAt: lastGood.successfulAt ?? lastGood.fetchedAt,
      report: lastGood.report as Extract<UsageReportEntry["report"], { status: "available" }>,
    },
  } as UsageReportEntry;
}

let root: Root;
let container: HTMLDivElement;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const hour = () => container.querySelector('[data-testid="session-quota-hour"]')?.textContent;
const label = () =>
  container.querySelector('[data-testid="session-quota"]')?.getAttribute("aria-label");

async function setVisible(visible: boolean) {
  world.visible = visible;
  await act(async () => {
    for (const listener of world.visibleListeners) listener();
  });
}

async function setTurn(phase: Turn["phase"]) {
  const { useSessionStore } = await import("@/stores/session-store");
  await act(async () => {
    useSessionStore.setState({
      sessions: {
        [SERVER]: {
          serverInfo: { features: { usageSources: true } },
          agents: new Map([[AGENT, { turn: { phase } }]]),
        },
      },
    } as never);
  });
}

beforeEach(async () => {
  vi.useFakeTimers({
    now: t0,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
  world.visible = true;
  world.requests = [];
  world.reply = [claude(37, 0)];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SessionQuota session={OPENED} layout="rail" />
      </QueryClientProvider>,
    );
    await vi.advanceTimersByTimeAsync(0);
  });
});

afterEach(async () => {
  await setTurn("idle");
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the rail's session quota stays current", () => {
  it("polls without a session switch, and never forces the provider", async () => {
    expect(hour()).toContain("37%");
    world.reply = () => [claude(41)];
    await advance(minutes(2));
    expect(hour()).toContain("41%");
    expect(world.requests.length).toBe(2);
    expect(world.requests.every((request) => request.agentId === AGENT)).toBe(true);
    expect(world.requests.some((request) => request.forceRefresh)).toBe(false);
  });

  it("asks nothing while the window is hidden, and once when it comes back", async () => {
    await setVisible(false);
    await advance(minutes(30));
    expect(world.requests.length).toBe(1);
    world.reply = [claude(44)];
    await setVisible(true);
    await advance(0);
    expect(world.requests.length).toBe(2);
    expect(hour()).toContain("44%");
  });

  it("reads again when the agent's turn ends, at most once every 30 seconds", async () => {
    await advance(minutes(1));
    expect(world.requests.length).toBe(1);
    await setTurn("open");
    await setTurn("idle");
    await advance(0);
    expect(world.requests.length).toBe(2);
    await setTurn("open");
    await setTurn("idle");
    await advance(0);
    expect(world.requests.length).toBe(2);
    await advance(30_000);
    await setTurn("open");
    await setTurn("idle");
    await advance(0);
    expect(world.requests.length).toBe(3);
  });
});

describe("when reads fail", () => {
  it("keeps the last numbers, marks them stale past a cache lifetime, and backs off", async () => {
    world.reply = () => new Error("connection lost");
    await advance(minutes(2));
    expect(hour()).toContain("37%");
    expect(label()).not.toContain("out of date");
    await advance(minutes(4));
    expect(label()).toContain("may be out of date");
    expect(hour()).toBe("~37% 1h");
    // Two minutes became five, then ten: an outage is asked about less and less.
    const gaps = world.requests
      .slice(1)
      .map((request, index) => request.at - world.requests[index]!.at);
    expect(gaps.every((gap, index) => index === 0 || gap >= gaps[index - 1]!)).toBe(true);
    await advance(minutes(60));
    expect(world.requests.length).toBeLessThanOrEqual(10);
  });

  it("keeps the numbers through the daemon's refused read, and recovers", async () => {
    const good = claude(37, 0);
    world.reply = () => [refused(good)];
    await advance(minutes(6));
    expect(hour()).toContain("37%");
    expect(label()).toContain("may be out of date");
    world.reply = () => [claude(52)];
    await advance(minutes(10));
    expect(hour()).toContain("52%");
    expect(label()).not.toContain("out of date");
  });

  it("keeps the numbers when an older daemon sends an error with no history", async () => {
    world.reply = () => [
      { ...claude(0), report: { status: "error", error: "429" } } as UsageReportEntry,
    ];
    await advance(minutes(6));
    expect(hour()).toContain("37%");
    expect(label()).toContain("may be out of date");
  });

  it("does not wait out an event: a finished turn during an outage reads no sooner", async () => {
    world.reply = () => new Error("connection lost");
    await advance(minutes(2));
    expect(world.requests.length).toBe(2);
    await setTurn("open");
    await setTurn("idle");
    await advance(0);
    expect(world.requests.length).toBe(2);
  });
});

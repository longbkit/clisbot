import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { buildFleet, FLEET_HUB_ORIGIN } from "./fleet-fixture";

/**
 * The real Command Center in Chromium over a synthetic fleet: 100 Hosts behind one Hub, about
 * 2,000 sessions. Data hooks are the boundary; matching, scope, rendering and the list are
 * production code. Measures typing-to-paint and checks the keyboard flow end to end.
 */

const fleet = vi.hoisted(() => ({ value: null as ReturnType<typeof buildFleet> | null }));
const flag = vi.hoisted(() => ({ enabled: true }));
/** Every `useProjects({ enabled })` the Command Center makes: `true` means it built its rows. */
const projectsDemand = vi.hoisted(() => ({ calls: [] as boolean[] }));
/** How many times the workspace rows were matched against the query. */
const workspaceMatching = vi.hoisted(() => ({ calls: 0 }));
/** A Host's live connection status, as the runtime reports it while it retries. */
const runtimeStatus = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    overrides: new Map<string, { status: string; lastError: string | null }>(),
    set(serverId: string, status: string, lastError: string | null) {
      this.overrides.set(serverId, { status, lastError });
      version += 1;
      for (const listener of listeners) listener();
    },
    reset() {
      this.overrides.clear();
      version += 1;
    },
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
const stable = vi.hoisted(() => ({
  hubAccounts: [
    {
      origin: "hub://company",
      enabled: true,
      signedIn: {
        organization: { name: "Company" },
        account: { id: "account-me" },
        membership: { id: "member-me" },
      },
      connection: null,
    },
  ],
  icons: new Map(),
  descriptor: { icon: () => null, statusBucket: "done", subtitle: "Codex" },
  fileSearch: { entries: [], loading: false, error: null, openFile: () => {} },
}));

vi.mock("@/clisbot/search-scope/active", async (importOriginal) => {
  const original = await importOriginal<typeof import("./active")>();
  return {
    ...original,
    get SEARCH_SCOPE_ENABLED() {
      return flag.enabled;
    },
  };
});
vi.mock("@/hooks/use-aggregated-agents", () => ({
  useAggregatedAgents: () => ({ agents: fleet.value!.agents }),
}));
vi.mock("@/hooks/use-projects", () => ({
  useProjects: (options?: { enabled?: boolean }) => {
    projectsDemand.calls.push(options?.enabled ?? true);
    return { projects: fleet.value!.projects };
  },
}));
vi.mock("@/clisbot/hub/host-inventory", () => ({
  useAvailableHosts: () => fleet.value!.hosts,
}));
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccounts: () => stable.hubAccounts,
}));
vi.mock("@/device-access/hub-profiles", () => ({
  useHubProfiles: () => ({ profiles: [] }),
  hubProfileOrigin: () => "",
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useLocalDaemonServerId: () => "local" }));
// Not `importOriginal`: the runtime imports modules that import it back, which deadlocks the mocker.
vi.mock("@/runtime/host-runtime", async () => {
  const { useSyncExternalStore } = await import("react");
  const snapshot = (serverId: string) => {
    const override = runtimeStatus.overrides.get(serverId);
    return {
      connectionStatus:
        override?.status ?? (fleet.value!.offline.has(serverId) ? "offline" : "online"),
      lastError: override?.lastError ?? null,
      lastOnlineAt: "2026-10-25T10:42:00.000Z",
    };
  };
  const store = {
    getSnapshot: snapshot,
    subscribe: () => () => {},
    subscribeAll: runtimeStatus.subscribe,
  };
  return {
    useHosts: () => fleet.value!.hosts,
    useHostRuntimeConnectionStatuses: (ids: readonly string[]) => {
      useSyncExternalStore(runtimeStatus.subscribe, runtimeStatus.version);
      return new Map(ids.map((id) => [id, snapshot(id).connectionStatus]));
    },
    getHostRuntimeStore: () => store,
    getHostRuntimeConnectionStatusSince: () => null,
    useHostRuntimeClient: () => null,
    useHostRuntimeSnapshot: () => null,
    useHostRuntimeIsConnected: () => true,
  };
});
// The shared stub theme has no palette; the list's real theme does.
vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (styles: unknown) =>
        typeof styles === "function" ? (styles as (theme: unknown) => unknown)(lightTheme) : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    useUnistyles: () => ({ theme: lightTheme, rt: {} }),
    UnistylesRuntime: { setTheme: () => undefined, themeName: "light" },
  };
});
vi.mock("@/projects/icons", () => ({ useProjectIcons: () => stable.icons }));
vi.mock("@/agent-presentation", () => ({
  useAgentDescriptor: () => stable.descriptor,
  resolveAgentLabel: (title: string | null) => title,
}));
vi.mock("@/workspace-status", () => ({ useWorkspaceStatus: () => "done" }));
vi.mock("@/command-center/workspace-search", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/command-center/workspace-search")>();
  return {
    ...original,
    filterAndRankWorkspaces: (...args: Parameters<typeof original.filterAndRankWorkspaces>) => {
      workspaceMatching.calls += 1;
      return original.filterAndRankWorkspaces(...args);
    },
  };
});
vi.mock("@/command-center/workspace-file-search", () => ({
  useWorkspaceFileSearch: () => stable.fileSearch,
}));

beforeEach(() => vi.stubGlobal("React", React));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const TOAST_API = { show: () => () => {}, copied: () => {}, error: () => {} };

async function mountCommandCenter({ open = true } = {}) {
  const [{ CommandCenter }, { CommandCenterProvider }, dispatcher, toast, store] =
    await Promise.all([
      import("@/command-center/command-center"),
      import("@/command-center/provider"),
      import("@/keyboard/keyboard-action-dispatcher-context"),
      import("@/contexts/toast-api-context"),
      import("@/stores/keyboard-shortcuts-store"),
    ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <dispatcher.KeyboardActionDispatcherProvider>
        <toast.ToastApiProvider api={TOAST_API}>
          <CommandCenterProvider>
            <CommandCenter />
          </CommandCenterProvider>
        </toast.ToastApiProvider>
      </dispatcher.KeyboardActionDispatcherProvider>,
    );
  });
  if (!open) return;
  await act(async () => store.useKeyboardShortcutsStore.getState().setCommandCenterOpen(true));
  await waitFor(() => input());
}

function input(): HTMLInputElement | null {
  return document.querySelector('[data-testid="command-center-input"]');
}

async function waitFor<T>(read: () => T | null | undefined | false, timeoutMs = 5000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (performance.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function setNativeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Input event to the second frame after it: what a typist waits for. */
async function typeAndMeasure(text: string): Promise<number[]> {
  const samples: number[] = [];
  for (let length = 1; length <= text.length; length += 1) {
    const started = performance.now();
    await act(async () => setNativeValue(input()!, text.slice(0, length)));
    await nextPaint();
    samples.push(performance.now() - started);
  }
  return samples;
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function press(key: string, init: KeyboardEventInit = {}) {
  return act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

const testId = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const SCOPED_P95_MAX_RATIO = 1.5;
const QUERIES = ["clisbot", "sandbox-4", "release", "billing sandbox-1", "may", "deploy anyapp"];

async function measureAll(): Promise<number[]> {
  const samples: number[] = [];
  for (const query of QUERIES) {
    samples.push(...(await typeAndMeasure(query)));
    await act(async () => setNativeValue(input()!, ""));
    await nextPaint();
  }
  return samples;
}

afterEach(async () => {
  runtimeStatus.reset();
  const store = await import("@/stores/keyboard-shortcuts-store");
  await act(async () => store.useKeyboardShortcutsStore.getState().setCommandCenterOpen(false));
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
});

const results: Record<string, { p50: number; p95: number; max: number; n: number }> = {};
afterAll(() => {
  // Read by the verification doc; printed so CI logs carry the numbers.
  console.log(`[search-scope-latency] ${JSON.stringify(results)}`);
});

describe("opening the Command Center over 2,000 sessions", () => {
  beforeEach(() => {
    fleet.value ??= buildFleet({ hosts: 100, sessions: 2000 });
    flag.enabled = true;
  });

  it("shows its focused input before it builds the rows", async () => {
    await mountCommandCenter({ open: false });
    projectsDemand.calls = [];
    const store = await import("@/stores/keyboard-shortcuts-store");
    // The press's own commit: the panel and its input, and no row built yet.
    await act(async () => store.useKeyboardShortcutsStore.getState().setCommandCenterOpen(true));
    expect(input()).not.toBeNull();
    expect(projectsDemand.calls).not.toContain(true);
    // The input's layout lets the rows follow.
    await waitFor(() => document.querySelector('[data-testid^="command-center-agent-"]'));
    expect(projectsDemand.calls).toContain(true);
  });
});

describe("Hosts that keep retrying while the Command Center is open", () => {
  beforeEach(() => {
    fleet.value ??= buildFleet({ hosts: 100, sessions: 2000 });
    flag.enabled = true;
  });

  // A phone's offline Hosts retry every few seconds. Each retry used to rebuild the scope catalog
  // and match every workspace and session again; with thousands of them the JS thread never went
  // idle and a pressed row never ran.
  it("does not match the rows again when a Host's status changes", async () => {
    await mountCommandCenter();
    await typeAndMeasure("clisbot");
    await waitFor(() => testId("command-center-scope-project-clisbot"));
    const matchedBefore = workspaceMatching.calls;
    // A Host retrying (still offline to search), then one going offline (its rows gain a note).
    for (const status of ["connecting", "error", "connecting", "error"]) {
      await act(async () => runtimeStatus.set("sb9", status, "connect ECONNREFUSED"));
    }
    await act(async () => runtimeStatus.set("sb3", "offline", null));
    await nextPaint();
    expect(workspaceMatching.calls).toBe(matchedBefore);
  });
});

describe("global search over 100 Hosts and 2,000 sessions", () => {
  beforeEach(() => {
    fleet.value ??= buildFleet({ hosts: 100, sessions: 2000 });
    flag.enabled = true;
  });

  it("finds Hosts and merged Projects, and Tab / Backspace manage chips", async () => {
    await mountCommandCenter();
    await typeAndMeasure("clisbot");
    const merged = await waitFor(() => testId("command-center-scope-project-clisbot"));
    expect(merged.textContent).toMatch(/clisbot.*on \d+ Hosts/);
    await press("Tab");
    await waitFor(() => testId("command-center-scope-chip-project:clisbot"));
    expect(input()!.value).toBe("");
    // Every listed session now belongs to clisbot.
    const sessions = [
      ...document.querySelectorAll('[data-testid^="command-center-agent-subtitle"]'),
    ];
    expect(sessions.length).toBeGreaterThan(0);
    await typeAndMeasure("sandbox-01");
    await waitFor(() => testId("command-center-scope-host-sb1"));
    await press("Enter");
    await waitFor(() => testId("command-center-scope-chip-host:sb1"));
    await press("Backspace");
    await waitFor(() => !testId("command-center-scope-chip-host:sb1"));
    expect(testId("command-center-scope-chip-project:clisbot")).not.toBeNull();
  });

  it("offers the Hub as one row and an empty state when the scope has no match", async () => {
    await mountCommandCenter();
    await typeAndMeasure("company");
    const hub = await waitFor(() => testId(`command-center-scope-hub-${FLEET_HUB_ORIGIN}`));
    expect(hub.textContent).toContain("99 Hosts");
    await press("Enter");
    await waitFor(() => testId(`command-center-scope-chip-hub:${FLEET_HUB_ORIGIN}`));
    await typeAndMeasure("zzzz-nothing");
    await waitFor(() => testId("command-center-scope-empty-remove-host"));
  });

  it("measures typing-to-paint with scope on and off", async () => {
    flag.enabled = false;
    await mountCommandCenter();
    await measureAll();
    const baseline = await measureAll();
    results.off = summarize(baseline);
    await act(async () => root?.unmount());
    flag.enabled = true;
    await mountCommandCenter();
    await measureAll();
    const scoped = await measureAll();
    results.on = summarize(scoped);
    // Kept beside the test run so the verification doc can quote the numbers.
    await commands.writeFile(
      ".vitest-screenshots/global-search-latency.json",
      JSON.stringify(results, null, 2),
    );
    // Gate on the same-run upstream baseline, like diff-performance.spec.ts gates on its baseline
    // times a multiplier: shared CI runners put upstream search itself past 100 ms at p95 (run
    // 40337654502: off 100.4, on 109.6), so the absolute 100 ms target is a dev-hardware number
    // kept in docs/features/global-search/verification.md, not a CI gate. Scope has added at most
    // 1.33x upstream p95 in recorded runs.
    expect(results.on.p95).toBeLessThan(results.off.p95 * SCOPED_P95_MAX_RATIO);
    // Four passes of 56 keystrokes, each waiting two frames, plus two mounts: about 10 s on a dev
    // machine and past the 15 s default on a CI runner (15.6 s in run 40356750337).
  }, 60_000);
});

function summarize(samples: number[]) {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    max: round(Math.max(...samples)),
    n: samples.length,
  };
}

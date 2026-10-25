import { describe, expect, it } from "vitest";
import type { SourceHealthSummary, SourceStatus } from "@/hooks/use-source-health";
import { connectionNoticeSummary } from "./connection-notice-model";

function status(overrides: Partial<SourceStatus>): SourceStatus {
  return {
    serverId: "s",
    label: "sandbox",
    hubOrigin: null,
    state: "offline",
    effectiveState: "offline",
    problem: "host-unreachable",
    error: "Disconnected",
    lastSyncedAt: null,
    ...overrides,
  } as SourceStatus;
}

function summary(overrides: Partial<SourceHealthSummary>): SourceHealthSummary {
  return {
    total: 0,
    reachable: 0,
    live: 0,
    syncing: 0,
    offline: 0,
    needsSignIn: 0,
    revoked: 0,
    degraded: [],
    hubs: [],
    ...overrides,
  };
}

const hub = (
  state: "live" | "unreachable" | "needs-sign-in",
  reachable: number,
  total: number,
) => ({
  origin: "https://hub.example",
  label: "Company Hub",
  state,
  lastSyncedAt: null,
  reachable,
  total,
});

describe("connectionNoticeSummary", () => {
  it("says nothing while every source is reachable", () => {
    expect(
      connectionNoticeSummary(summary({ total: 3, reachable: 3, hubs: [hub("live", 2, 2)] })),
    ).toBeNull();
  });

  it("names one unreachable Hub once, not each of its sandboxes", () => {
    const degraded = Array.from({ length: 10 }, (_, i) =>
      status({
        serverId: `s${i}`,
        label: `sb-${i}`,
        hubOrigin: "https://hub.example",
        problem: "hub-unreachable",
      }),
    );
    const text = connectionNoticeSummary(summary({ degraded, hubs: [hub("unreachable", 0, 10)] }));
    expect(text).toContain("Company Hub");
    expect(text).toContain("VPN");
    expect(text).not.toContain("more");
  });

  it("reports partial Hub reachability as x/y", () => {
    const degraded = [status({ hubOrigin: "https://hub.example", label: "sb-9" })];
    expect(connectionNoticeSummary(summary({ degraded, hubs: [hub("live", 92, 100)] }))).toBe(
      "Company Hub: 92/100 reachable",
    );
  });

  it("names a personal Host and counts the rest", () => {
    const degraded = [
      status({ serverId: "a", label: "remote" }),
      status({ serverId: "b", label: "laptop" }),
    ];
    const text = connectionNoticeSummary(summary({ degraded }));
    expect(text).toMatch(/^remote: .* · 1 more$/);
  });

  it("asks to sign in to a Hub before anything else", () => {
    expect(connectionNoticeSummary(summary({ hubs: [hub("needs-sign-in", 0, 4)] }))).toBe(
      "Sign in to Company Hub again.",
    );
  });
});

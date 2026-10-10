import { expect, test } from "vitest";
import {
  CONNECT_STALL_MS,
  connectionIssues,
  effectiveHostStatus,
  hubSubtitle,
  onlineSummary,
  pickStripHosts,
  type StripHost,
  type StripHub,
} from "./hosts-strip-model";

function host(serverId: string, extra: Partial<StripHost> = {}): StripHost {
  return {
    serverId,
    label: serverId,
    local: false,
    status: "online",
    lastActivity: null,
    hubOrigin: null,
    named: !extra.hubOrigin,
    ...extra,
  };
}

test("a small Hub's Hosts are listed by name and count as yours", () => {
  const hosts = [
    host("mac", { hubOrigin: "hub://team", named: true }),
    host("build", { hubOrigin: "hub://team", named: true, status: "offline" }),
  ];
  expect(pickStripHosts(hosts).map((entry) => entry.serverId)).toEqual(["mac", "build"]);
  expect(connectionIssues(hosts, []).map((issue) => issue.kind)).toEqual(["host"]);
});

test("this computer leads, then recently used Hosts; a shared Hub's unused Hosts stay in its entry", () => {
  const hosts = [
    host("company-a", { hubOrigin: "hub://co" }),
    host("company-used", { hubOrigin: "hub://co", lastActivity: 50 }),
    host("dev-server", { lastActivity: 100 }),
    host("studio", { status: "offline" }),
    host("this-mac", { local: true }),
  ];
  expect(pickStripHosts(hosts).map((entry) => entry.serverId)).toEqual([
    "this-mac",
    "dev-server",
    "company-used",
    "studio",
  ]);
  expect(pickStripHosts(hosts, 1).map((entry) => entry.serverId)).toEqual([
    "this-mac",
    "dev-server",
  ]);
});

test("issues are only what the user can act on", () => {
  const hosts = [
    host("studio", { status: "offline" }),
    host("unused-company", { status: "offline", hubOrigin: "hub://co" }),
    host("used-company", { status: "error", hubOrigin: "hub://co", lastActivity: 1 }),
    host("connecting", { status: "connecting" }),
  ];
  const hubs: StripHub[] = [
    { origin: "hub://co", name: "Vexere", personal: false, state: "online", online: 3, total: 124 },
    { origin: "hub://old", name: "Old", personal: true, state: "signIn", online: 0, total: 0 },
    {
      origin: "hub://far",
      name: "Far",
      personal: false,
      state: "unreachable",
      online: 0,
      total: 0,
    },
  ];
  expect(connectionIssues(hosts, hubs)).toEqual([
    { kind: "host", serverId: "studio", label: "studio", status: "offline", hubName: null },
    {
      kind: "host",
      serverId: "used-company",
      label: "used-company",
      status: "error",
      hubName: "Vexere",
    },
    { kind: "signIn", origin: "hub://old", name: "Old" },
    { kind: "unreachable", origin: "hub://far", name: "Far" },
  ]);
  expect(onlineSummary(hosts)).toEqual({ online: 0, total: 4 });
  expect(hubs.map(hubSubtitle)).toEqual(["3/124 online", "Sign in", "Unreachable"]);
  const fresh = { origin: "hub://new", name: "New", personal: false, online: 0, total: 0 };
  expect(hubSubtitle({ ...fresh, state: "setup" })).toBe("Finish setup");
  expect(hubSubtitle({ ...fresh, state: "online" })).toBe("No Hosts yet");
  expect(connectionIssues([], [{ ...fresh, state: "setup" }])).toEqual([
    { kind: "setup", origin: "hub://new", name: "New" },
  ]);
});

test("a Host stuck connecting, or retrying after an error, counts as unreachable", () => {
  const base = { since: 1000, lastError: null, now: 2000 };
  expect(effectiveHostStatus({ ...base, status: "connecting" })).toBe("connecting");
  expect(effectiveHostStatus({ ...base, status: "connecting", lastError: "refused" })).toBe(
    "error",
  );
  expect(
    effectiveHostStatus({ ...base, status: "connecting", now: 1000 + CONNECT_STALL_MS + 1 }),
  ).toBe("error");
  expect(effectiveHostStatus({ ...base, status: "online", lastError: "old" })).toBe("online");
});

import { expect, test } from "vitest";
import {
  CONNECT_STALL_MS,
  connectionIssues,
  effectiveHostStatus,
  hostsWithSessionsKey,
  hubSubtitle,
  onlineSummary,
  parseHostsWithSessionsKey,
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
    hasSessions: false,
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
  expect(pickStripHosts(hosts).map((entry) => entry.serverId)).toEqual(["build", "mac"]);
  expect(connectionIssues(hosts, []).map((issue) => issue.kind)).toEqual(["host"]);
});

test("this computer leads, then named Hosts in stable name order; shared Hub Hosts stay in their entry", () => {
  const hosts = [
    host("company-a", { hubOrigin: "hub://co" }),
    host("company-used", { hubOrigin: "hub://co", hasSessions: true }),
    host("dev-server", { hasSessions: true }),
    host("studio", { status: "offline" }),
    host("this-mac", { local: true }),
  ];
  expect(pickStripHosts(hosts).map((entry) => entry.serverId)).toEqual([
    "this-mac",
    "dev-server",
    "studio",
  ]);
  expect(pickStripHosts(hosts, 1).map((entry) => entry.serverId)).toEqual([
    "this-mac",
    "dev-server",
  ]);
});

test("activity, connection flapping and directory arrival order never replace or reorder Host slots", () => {
  const hosts = [host("z"), host("b"), host("a"), host("c")];
  const before = pickStripHosts(hosts).map((entry) => entry.serverId);
  expect(before).toEqual(["a", "b", "c"]);
  const changed = hosts.toReversed().map((entry, index) =>
    host(entry.serverId, {
      hasSessions: index % 2 === 0,
      status: "offline" as const,
    }),
  );
  expect(pickStripHosts(changed).map((entry) => entry.serverId)).toEqual(before);
  expect(
    pickStripHosts([host("b", { label: "Same" }), host("a", { label: "Same" })]).map(
      (entry) => entry.serverId,
    ),
  ).toEqual(["a", "b"]);
});

test("issues are only what the user can act on", () => {
  const hosts = [
    host("studio", { status: "offline" }),
    host("unused-company", { status: "offline", hubOrigin: "hub://co" }),
    host("used-company", { status: "error", hubOrigin: "hub://co", hasSessions: true }),
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

test("Hosts with a live session, keyed so a session update elsewhere keeps the same key", () => {
  const live: { archivedAt: Date | null } = { archivedAt: null };
  const archived: { archivedAt: Date | null } = {
    archivedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
  const sessions = {
    used: {
      agents: new Map([
        ["a", archived],
        ["b", live],
      ]),
    },
    archivedOnly: { agents: new Map([["a", archived]]) },
    empty: { agents: new Map() },
    another: { agents: new Map([["a", live]]) },
    missing: undefined,
  };
  const key = hostsWithSessionsKey(sessions);
  expect(key).toBe("another\nused");
  expect(parseHostsWithSessionsKey(key)).toEqual(new Set(["another", "used"]));
  const updated = {
    ...sessions,
    used: {
      agents: new Map([
        ["b", live],
        ["c", live],
      ]),
    },
  };
  expect(hostsWithSessionsKey(updated)).toBe(key);
  expect(parseHostsWithSessionsKey("")).toEqual(new Set());
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

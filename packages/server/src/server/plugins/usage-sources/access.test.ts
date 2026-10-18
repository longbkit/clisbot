import { expect, test } from "vitest";
import { UsageSourceRegistry } from "./index.js";

test("provider grants filter mixed-account logins before fetch, cache and explicit refresh", async () => {
  const fetched: string[] = [];
  const registry = new UsageSourceRegistry();
  registry.register({
    id: "quota",
    label: "Quota",
    discover: async () => [
      { key: "shared", providerId: "codex", harness: "Codex", input: "codex" },
      { key: "shared", providerId: "opencode", harness: "OpenCode", input: "opencode" },
      { key: "private", providerId: "claude", input: "claude" },
      { key: "unknown", input: "unknown" },
    ],
    fetch: async (input) => {
      fetched.push(String(input));
      return { status: "available", windows: [{ id: "quota", label: String(input) }] };
    },
  });
  await registry.listReports(); // Populate the unrestricted cache first.
  fetched.length = 0;
  const canReadProvider = (id: string | undefined) => id === "codex";
  const reports = await registry.listReports({ canReadProvider });
  expect(reports.map((r) => r.id)).toEqual(["quota:shared"]);
  expect(fetched).toEqual(["codex"]);
  fetched.length = 0;
  const refresh = await registry.listReports({
    reportIds: ["quota:private", "quota:unknown", "quota:shared"],
    forceRefresh: true,
    canReadProvider,
  });
  expect(refresh.map((r) => r.id)).toEqual(["quota:shared"]);
  expect(fetched).toEqual(["codex"]);
  expect(
    (await registry.listLegacyUsage({ canReadProvider })).providers.map((r) => r.providerId),
  ).toEqual(["quota"]);
});

test("revocation during fetch suppresses streamed and returned usage", async () => {
  let allowed = true;
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  const registry = new UsageSourceRegistry();
  registry.register({
    id: "source",
    label: "Source",
    discover: async () => [{ key: "one", providerId: "codex", input: "login" }],
    fetch: () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const streamed: string[] = [];
  const request = registry.listReports({
    canReadProvider: () => allowed,
    onReport: (r) => streamed.push(r.id),
  });
  await fetching;
  allowed = false;
  finish({ status: "available", windows: [] });
  expect(await request).toEqual([]);
  expect(streamed).toEqual([]);
});

test("custom provider authorization stays distinct from its base discovery harness", async () => {
  const fetched: string[] = [];
  const registry = new UsageSourceRegistry(
    Date.now,
    300000,
    { warn: () => {} },
    {
      hasAgent: () => true,
      providerId: () => "work-codex",
      usageSession: () => ({
        provider: "codex",
        env: { CODEX_HOME: "/work-login" },
        sessionKey: "one",
      }),
    },
  );
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) =>
      scope.kind === "global"
        ? [{ key: "base", providerId: "codex", input: "base" }]
        : [{ key: "work", providerId: "codex", input: scope.env.CODEX_HOME }],
    fetch: async (input) => {
      fetched.push(String(input));
      return { status: "available", windows: [] };
    },
  });
  const canReadProvider = (id: string | undefined) => id === "work-codex";
  expect(
    (await registry.listReports({ agentId: "agent", canReadProvider })).map((r) => r.id),
  ).toEqual(["codex:work"]);
  expect((await registry.listReports({ canReadProvider })).map((r) => r.id)).toEqual([
    "codex:work",
  ]);
  expect(fetched).toEqual(["/work-login"]);
});

test("failed permitted login does not expose another provider's fallback errors", async () => {
  const fetched: string[] = [];
  const registry = new UsageSourceRegistry();
  registry.register({
    id: "shared",
    label: "Shared",
    discover: async () => [
      { key: "one", providerId: "codex", harness: "Codex", input: "allowed" },
      { key: "one", providerId: "claude", harness: "Claude", input: "private" },
    ],
    fetch: async (input) => {
      fetched.push(String(input));
      return { status: "error", error: String(input) };
    },
  });
  const [entry] = await registry.listReports({ canReadProvider: (id) => id === "codex" });
  expect(fetched).toEqual(["allowed"]);
  expect(entry?.loginErrors).toEqual([
    { harness: "Codex", report: { status: "error", error: "allowed" } },
  ]);
});

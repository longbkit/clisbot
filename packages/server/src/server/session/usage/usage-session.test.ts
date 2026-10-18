import pino from "pino";
import { expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSourceRegistry } from "../../plugins/usage-sources/index.js";
import { UsageSession } from "./usage-session.js";

test("lists reports from usage sources", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports(options) {
        requested.push({ forceRefresh: options.forceRefresh, reportIds: options.reportIds });
        options.onReport?.(entry);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "list" });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  expect(emitted).toEqual([
    { type: "usage.list_reports.update", payload: { requestId: "list", report: entry } },
    { type: "usage.list_reports.response", payload: { requestId: "list", error: null } },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

test("request failures terminate with an error response and no updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "failed" });
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: { requestId: "failed", error: "Plugin runtime is unavailable" },
    },
  ]);
});

test("modern streams, legacy lists and explicit refresh expose only permitted provider usage", async () => {
  const registry = new UsageSourceRegistry();
  const fetched: string[] = [];
  registry.register({
    id: "fixture",
    label: "Fixture",
    discover: async () => [
      { key: "allowed", providerId: "codex", input: "codex" },
      { key: "private", providerId: "claude", input: "claude" },
    ],
    fetch: async (input) => {
      fetched.push(String(input));
      return { status: "available", windows: [] };
    },
  });
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    canReadProvider: (id) => id === "codex",
    runtime: {
      listUsageReports: (options) => registry.listReports(options),
      listLegacyUsage: (options) => registry.listLegacyUsage(options),
    },
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "modern" });
  expect(emitted.map((m) => m.type)).toEqual([
    "usage.list_reports.update",
    "usage.list_reports.response",
  ]);
  expect(emitted[0]).toMatchObject({ payload: { report: { id: "fixture:allowed" } } });
  emitted.length = 0;
  await usage.handleListReports({
    type: "usage.list_reports.request",
    requestId: "forged",
    reportIds: ["fixture:private"],
    forceRefresh: true,
  });
  expect(emitted).toEqual([
    { type: "usage.list_reports.response", payload: { requestId: "forged", error: null } },
  ]);
  emitted.length = 0;
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "legacy" });
  expect(emitted[0]).toMatchObject({
    type: "provider.usage.list.response",
    payload: { providers: [{ providerId: "fixture", status: "available" }] },
  });
  expect(fetched).toEqual(["codex"]);
});

test("legacy result is withheld when authority changes after the runtime resolves", async () => {
  let key = "codex";
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    accessKey: () => key,
    runtime: {
      listUsageReports: async () => [],
      listLegacyUsage: async () => {
        key = "claude";
        return { fetchedAt: "now", providers: [] };
      },
    },
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "race" });
  expect(emitted).toEqual([
    {
      type: "rpc_error",
      payload: {
        requestId: "race",
        requestType: "provider.usage.list.request",
        error: "Failed to list provider usage: Usage access changed; retry the request",
        code: "provider_usage_list_failed",
      },
    },
  ]);
});

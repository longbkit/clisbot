import { describe, expect, it } from "vitest";
import {
  CHANNEL_STATUS_LABELS,
  channelAccountHealthRows,
  channelCatalogRows,
} from "./channel-account-health";
import { CHANNEL_CATALOG_FIXTURE as catalog } from "./channel-catalog.fixture";

const connections = [
  { id: "conn-1", provider: "telegram", name: "support", externalName: "@longluong3bot" },
];

const accounts = [
  { channel: "telegram", accountId: "support", enabled: true, connectionId: "conn-1" },
  { channel: "slack", accountId: "acme", enabled: false, connectionId: "conn-missing" },
];

const runtime = [
  {
    channel: "telegram",
    account: "support",
    transport: "started" as const,
    ingress: {
      pending: 2,
      claimed: 0,
      retrying: 0,
      deadLettered: 1,
      oldestPendingAgeMs: 120_000,
      lanesBlocked: 0,
    },
  },
  {
    channel: "slack",
    account: "acme",
    transport: "failed" as const,
    detail: "invalid_auth",
  },
];

describe("account health join", () => {
  const rows = channelAccountHealthRows({ accounts, runtime, connections, catalog });

  it("joins runtime state, queue depth and the Connection identity", () => {
    expect(rows[0]).toMatchObject({
      key: "telegram:support",
      channelLabel: "Telegram",
      enabled: true,
      transport: "started",
      transportLabel: "Running",
      identity: "@longluong3bot",
      ingressSummary: "2 pending · 1 dead-lettered",
      oldestPending: "2m",
      severity: "error",
    });
  });

  it("reports no identity when the Connection cannot be resolved", () => {
    expect(rows[1]).toMatchObject({
      key: "slack:acme",
      enabled: false,
      transport: "failed",
      transportLabel: "Failed",
      detail: "invalid_auth",
      identity: null,
      connectionId: "conn-missing",
      ingress: null,
      severity: "error",
    });
  });

  it("distinguishes an account with no runtime row from a stopped one", () => {
    const [orphan] = channelAccountHealthRows({
      accounts: [{ channel: "telegram", accountId: "quiet" }],
      runtime: [],
      connections: [],
      catalog,
    });
    expect(orphan).toMatchObject({
      transport: null,
      transportLabel: "Not running",
      enabled: true,
      severity: "warning",
    });
  });

  it("skips a record that names no channel or account", () => {
    expect(
      channelAccountHealthRows({
        accounts: [{ enabled: true }, { channel: "telegram" }],
        runtime: [],
        connections: [],
        catalog,
      }),
    ).toEqual([]);
  });

  it("takes queue severity from a running account", () => {
    const [row] = channelAccountHealthRows({
      accounts: [{ channel: "telegram", accountId: "calm" }],
      runtime: [
        {
          channel: "telegram",
          account: "calm",
          transport: "started",
          ingress: {
            pending: 1,
            claimed: 0,
            retrying: 0,
            deadLettered: 0,
            oldestPendingAgeMs: 1_000,
            lanesBlocked: 0,
          },
        },
      ],
      connections: [],
      catalog,
    });
    expect(row?.severity).toBe("ok");
  });
});

describe("catalog rows", () => {
  const rows = channelCatalogRows(
    channelAccountHealthRows({ accounts, runtime, connections, catalog }),
    catalog,
  );

  it("lists every catalog channel in catalog order", () => {
    expect(rows.slice(0, 7).map((row) => row.channel)).toEqual([
      "slack",
      "telegram",
      "discord",
      "googlechat",
      "feishu",
      "zalouser",
      "zalo",
    ]);
  });

  it("marks a QR channel as not connectable through the Connection form", () => {
    const zalouser = rows.find((row) => row.channel === "zalouser");
    expect(zalouser).toMatchObject({ status: "in-repo", connectable: false });
    expect(CHANNEL_STATUS_LABELS["planned"]).toBe("Coming soon");
    expect(CHANNEL_STATUS_LABELS["unknown"]).toBe("Reported by this Hub");
  });

  it("groups accounts under their channel", () => {
    expect(
      rows.find((row) => row.channel === "telegram")?.accounts.map((a) => a.accountId),
    ).toEqual(["support"]);
    expect(rows.find((row) => row.channel === "discord")?.accounts).toEqual([]);
  });

  it("still shows every configured account when the catalog is unavailable", () => {
    const withoutCatalog = channelCatalogRows(
      channelAccountHealthRows({ accounts, runtime, connections, catalog: [] }),
      [],
    );
    expect(withoutCatalog.map((row) => row.channel)).toEqual(["slack", "telegram"]);
    expect(withoutCatalog.every((row) => row.status === "unknown")).toBe(true);
    expect(withoutCatalog[1]?.label).toBe("telegram");
  });

  it("keeps a channel only the Hub knows about visible, after the catalog", () => {
    const withUnknown = channelCatalogRows(
      channelAccountHealthRows({
        accounts: [...accounts, { channel: "matrix", accountId: "ops" }],
        runtime,
        connections,
        catalog,
      }),
      catalog,
    );
    const last = withUnknown[withUnknown.length - 1];
    expect(last).toMatchObject({ channel: "matrix", status: "unknown", connectable: false });
    expect(last?.accounts.map((account) => account.accountId)).toEqual(["ops"]);
  });
});

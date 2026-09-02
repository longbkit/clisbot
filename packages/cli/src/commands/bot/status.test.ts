import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import type { ControlPlaneTarget } from "../control-plane.js";
import { buildStatusReport, type BotStatusReport } from "./status.js";
import type { BotManifest } from "./manifest.js";
import { writeBotManifest } from "./manifest.js";
import { runBotStatusCommand } from "./status.js";
import type { ChannelStatusAccount } from "../channels/client.js";

const servers: Array<ReturnType<typeof createServer>> = [];

function manifest(overrides: Partial<BotManifest> = {}): BotManifest {
  return {
    version: 1,
    name: "personal-assistant",
    botType: "personal",
    provider: "codex",
    workspacePath: "/home/op/workspaces/default",
    workspaceId: "ws-1",
    agentId: "ag-1",
    agentTitle: "personal-assistant",
    channel: "telegram",
    account: "personal-assistant",
    credentials: { "telegram:personal-assistant": { persisted: true } },
    createdAt: "t0",
    updatedAt: "t0",
    ...overrides,
  };
}

const LIVE: ChannelStatusAccount[] = [
  {
    channel: "telegram",
    account: "personal-assistant",
    pin: "paseo-telegram@0.1.0",
    integrity: "ok",
    loadTrace: "ok",
    transport: "polling",
  },
];

describe("buildStatusReport", () => {
  it("joins a live account into the report", () => {
    const report: BotStatusReport = buildStatusReport(manifest(), LIVE[0]);
    assert.equal(report.name, "personal-assistant");
    assert.equal(report.credential, "persisted");
    assert.equal(report.running, true);
    assert.equal(report.transport, "polling");
    assert.equal(report.integrity, "ok");
    assert.equal(report.loadTrace, "ok");
    assert.equal(report.pin, "paseo-telegram@0.1.0");
  });

  it("marks an absent account as not running", () => {
    const report: BotStatusReport = buildStatusReport(manifest(), undefined);
    assert.equal(report.running, false);
    assert.equal(report.transport, undefined);
    assert.equal(report.integrity, undefined);
    assert.equal(report.loadTrace, undefined);
    assert.equal(report.pin, undefined);
  });

  it("reports the durable encrypted Hub credential", () => {
    const report: BotStatusReport = buildStatusReport(
      manifest({ credentials: { "telegram:personal-assistant": { persisted: true } } }),
      LIVE[0],
    );
    assert.equal(report.credential, "persisted");
  });
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

/** A `channelStatus`-shaped GET served on a local HTTP server. */
async function statusServer(accounts: ChannelStatusAccount[]): Promise<ControlPlaneTarget> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accounts }));
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${address.port}`, source: "local" });
    });
  });
}

describe("runBotStatusCommand", () => {
  it("reads the manifest and the live status, joining on channel + account", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-status-"));
    const target = await statusServer(LIVE);
    try {
      await writeBotManifest(home, manifest());
      const result = await runBotStatusCommand(
        "personal-assistant",
        { home, hub: target.origin },
        undefined as never,
      );
      assert.equal(result.type, "single");
      assert.equal(result.data.agentId, "ag-1");
      assert.equal(result.data.workspaceId, "ws-1");
      assert.equal(result.data.running, true);
      assert.equal(result.data.transport, "polling");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports a bot absent from the manifest as BOT_NOT_FOUND", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-status-"));
    const target = await statusServer(LIVE);
    try {
      await assert.rejects(
        runBotStatusCommand("ghost", { home, hub: target.origin }, undefined as never),
        (error: unknown) =>
          (error as { code?: string }).code === "BOT_NOT_FOUND" &&
          /No bot named "ghost"/.test((error as { message: string }).message),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("marks a manifest whose account is not live as not running", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-status-"));
    // The live status has no slack account, so the slack bot is not running.
    const target = await statusServer(LIVE);
    try {
      await writeBotManifest(
        home,
        manifest({
          name: "slack-bot",
          channel: "slack",
          account: "work",
          credentials: { "slack:work": { persisted: true } },
        }),
      );
      const result = await runBotStatusCommand(
        "slack-bot",
        { home, hub: target.origin },
        undefined as never,
      );
      assert.equal(result.data.running, false);
      assert.equal(result.data.credential, "persisted");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

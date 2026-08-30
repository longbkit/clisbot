import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import type { ControlPlaneTarget } from "../control-plane.js";
import type { ChannelStatusAccount } from "../channels/client.js";
import type { BotManifest } from "./manifest.js";
import { writeBotManifest } from "./manifest.js";
import { buildBotListEntry, runBotListCommand } from "./list.js";

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
    integrity: "ok",
    loadTrace: "ok",
    transport: "polling",
  },
];

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

describe("buildBotListEntry", () => {
  it("joins a live account into the entry", () => {
    const entry = buildBotListEntry(manifest(), LIVE);
    assert.equal(entry.name, "personal-assistant");
    assert.equal(entry.running, true);
    assert.equal(entry.transport, "polling");
    assert.equal(entry.credential, "persisted");
  });

  it("marks an absent account as not running with no transport", () => {
    const entry = buildBotListEntry(
      manifest({
        channel: "slack",
        account: "work",
        credentials: { "slack:work": { persisted: false } },
      }),
      LIVE,
    );
    assert.equal(entry.running, false);
    assert.equal(entry.transport, undefined);
    assert.equal(entry.credential, "runtime-only");
  });
});

describe("runBotListCommand", () => {
  it("lists every bot joined with the live status", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-list-"));
    const target = await statusServer(LIVE);
    try {
      await writeBotManifest(home, manifest());
      await writeBotManifest(
        home,
        manifest({
          name: "slack-bot",
          channel: "slack",
          account: "work",
          agentId: "ag-2",
          credentials: { "slack:work": { persisted: false } },
        }),
      );
      const result = await runBotListCommand({ home, hub: target.origin }, undefined as never);
      assert.equal(result.type, "list");
      assert.equal(result.data.length, 2);
      const [telegram, slack] = result.data;
      assert.equal(telegram?.name, "personal-assistant");
      assert.equal(telegram?.running, true);
      assert.equal(slack?.name, "slack-bot");
      assert.equal(slack?.running, false);
      assert.equal(slack?.credential, "runtime-only");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the home has no bots", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-list-"));
    const target = await statusServer(LIVE);
    try {
      const result = await runBotListCommand({ home, hub: target.origin }, undefined as never);
      assert.equal(result.type, "list");
      assert.deepEqual(result.data, []);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import type { BotStartDeps, BotStartReport } from "./run.js";
import { isNoActiveConfiguration, runBotStart } from "./run.js";
import { readBotManifest, writeBotManifest } from "./manifest.js";
import type { BotStartOptions } from "./plan.js";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const HOME = "/home/op/.clisbot";

function options(overrides: Partial<BotStartOptions> = {}): BotStartOptions {
  return { provider: "codex", telegramBotToken: "tg-token", ...overrides };
}

function fakeDeps(overrides: Partial<BotStartDeps> = {}): BotStartDeps & {
  addChannelCalls: unknown[];
} {
  const addChannelCalls: unknown[] = [];
  return {
    addChannelCalls,
    ensureHubUp: async () => ({ hub: "already-running", url: "http://127.0.0.1:6868" }),
    waitHubReady: async () => undefined,
    ensureDaemonUp: async () => ({ daemon: "already-running" }),
    waitDaemonUp: async () => undefined,
    daemonHost: () => "127.0.0.1:6767",
    daemonPassword: () => undefined,
    openDaemon: async () => ({}) as unknown as DaemonClient,
    closeDaemon: async () => undefined,
    providerKnown: async () => true,
    createWorkspace: async () => ({ id: "ws-new", directory: `${HOME}/workspaces/default` }),
    createIdleAgent: async () => ({ id: "ag-new" }),
    ensureWorkspaceDir: async () => undefined,
    addChannel: async (input) => {
      addChannelCalls.push(input);
      return {
        channel: input.channel,
        account: input.account,
        installed: true,
        revision: false,
        transport: "started",
      };
    },
    channelStatus: async () => [
      {
        channel: "telegram",
        account: "personal-assistant",
        integrity: "ok",
        loadTrace: "ok",
        transport: "started",
      },
    ],
    persistCredential: () => `${HOME}/secrets/telegram-personal-assistant.json`,
    readManifest: (home, name) => readBotManifest(home, name),
    writeManifest: (home, manifest) => writeBotManifest(home, manifest),
    ...overrides,
  };
}

describe("runBotStart", () => {
  it("creates a bot bundle and records the manifest", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-run-"));
    const deps = fakeDeps();
    try {
      const report: BotStartReport = await runBotStart({ options: options(), home, env: {} }, deps);
      assert.equal(report.name, "personal-assistant");
      assert.equal(report.reused, false);
      assert.equal(report.agentId, "ag-new");
      assert.equal(report.workspaceId, "ws-new");
      assert.equal(report.channel, "telegram");
      assert.equal(report.account, "personal-assistant");
      assert.equal(report.credential, "runtime-only");
      assert.equal(report.hub, "already-running");
      assert.equal(report.hubUrl, "http://127.0.0.1:6868");
      assert.equal(report.daemon, "already-running");
      assert.equal(report.daemonHost, "127.0.0.1:6767");
      assert.equal(report.channelTransport, "started");
      assert.match(report.nextStep, /Telegram group/);
      assert.match(report.routeNote, /route matching account "personal-assistant"/);

      const manifest = await readBotManifest(home, "personal-assistant");
      assert.notEqual(manifest, null);
      assert.equal(manifest?.agentId, "ag-new");
      assert.equal(manifest?.workspaceId, "ws-new");
      assert.deepEqual(manifest?.credentials, {
        "telegram:personal-assistant": { persisted: false },
      });
      assert.equal(deps.addChannelCalls.length, 1);
      const call = deps.addChannelCalls[0] as { channel: string; account: string; secret: string };
      assert.equal(call.channel, "telegram");
      assert.deepEqual(JSON.parse(call.secret), { botToken: "tg-token" });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("persists the credential file and records it in the manifest", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-run-"));
    const deps = fakeDeps();
    try {
      const report = await runBotStart(
        { options: options({ persist: true, provider: "claude" }), home, env: {} },
        deps,
      );
      assert.equal(report.credential, "persisted");
      const manifest = await readBotManifest(home, "personal-assistant");
      assert.deepEqual(manifest?.credentials, {
        "telegram:personal-assistant": {
          persisted: true,
          secretPath: `${HOME}/secrets/telegram-personal-assistant.json`,
        },
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reuses an unchanged bot without creating a new workspace or agent", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-run-"));
    try {
      await writeBotManifest(home, {
        version: 1,
        name: "personal-assistant",
        botType: "personal",
        provider: "codex",
        workspacePath: `${HOME}/workspaces/default`,
        workspaceId: "ws-old",
        agentId: "ag-old",
        agentTitle: "personal-assistant",
        channel: "telegram",
        account: "personal-assistant",
        credentials: {},
        createdAt: "t0",
        updatedAt: "t0",
      });
      const deps = fakeDeps();
      const report = await runBotStart({ options: options(), home, env: {} }, deps);
      assert.equal(report.reused, true);
      assert.equal(report.agentId, "ag-old");
      assert.equal(report.workspaceId, "ws-old");
      assert.equal(deps.addChannelCalls.length, 1);
      const manifest = await readBotManifest(home, "personal-assistant");
      assert.equal(manifest?.agentId, "ag-old");
      assert.equal(manifest?.workspaceId, "ws-old");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("translates the cold-instance 409 into NO_ACTIVE_CONFIGURATION", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-run-"));
    const deps = fakeDeps({
      addChannel: async () => {
        throw {
          code: "HUB_REQUEST_FAILED",
          message: "Control plane unavailable: the default project has no active configuration",
        };
      },
    });
    try {
      await assert.rejects(
        runBotStart({ options: options(), home, env: {} }, deps),
        (error: unknown) =>
          (error as { code?: string }).code === "NO_ACTIVE_CONFIGURATION" &&
          /hub init/.test((error as { message: string }).message),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports an unknown provider with the custom-ACP pointer", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-run-"));
    const deps = fakeDeps({ providerKnown: async () => false });
    try {
      await assert.rejects(
        runBotStart({ options: options({ provider: "custom-llm" }), home, env: {} }, deps),
        (error: unknown) =>
          (error as { code?: string }).code === "UNKNOWN_PROVIDER" &&
          /agents.providers/.test((error as { details: unknown }).details as string),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("isNoActiveConfiguration", () => {
  it("matches the conforming problem body", () => {
    assert.equal(
      isNoActiveConfiguration({
        code: "HUB_REQUEST_FAILED",
        message: "Control plane unavailable: the default project has no active configuration",
      }),
      true,
    );
  });

  it("matches the plain HTTP 409 report", () => {
    assert.equal(
      isNoActiveConfiguration({
        code: "HUB_REQUEST_FAILED",
        message: "Hub channel add failed with HTTP 409.",
      }),
      true,
    );
  });

  it("does not match unrelated HUB_REQUEST_FAILED errors", () => {
    assert.equal(
      isNoActiveConfiguration({
        code: "HUB_REQUEST_FAILED",
        message: "Hub channel add failed with HTTP 500.",
      }),
      false,
    );
  });

  it("does not match non-object errors", () => {
    assert.equal(isNoActiveConfiguration(new Error("boom")), false);
    assert.equal(isNoActiveConfiguration(null), false);
  });
});

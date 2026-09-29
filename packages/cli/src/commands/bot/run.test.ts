import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { runBotStart, type BotStartDeps } from "./run.js";
import { initializeAssistantWorkspace } from "./init.js";
import { readBotManifest, writeBotManifest } from "./manifest.js";

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "bot-onboarding-"));
  const deps: BotStartDeps = {
    ensureHubUp: async () => ({ hub: "started", url: "http://localhost:6868" }),
    waitHubReady: async () => {},
    ensureDaemonUp: async () => ({ daemon: "started" }),
    waitDaemonUp: async () => {},
    daemonHost: () => "localhost:6767",
    daemonPassword: () => undefined,
    openDaemon: async () => ({}) as DaemonClient,
    closeDaemon: vi.fn(async () => {}),
    prepareOnboarding: async () => ({ daemonId: "daemon-1", ownerEmail: "owner@example.com" }),
    provisionBot: vi.fn(async () => ({
      botId: "bot_1234567890123456",
      agentId: "",
      agentTitle: "Assistant",
      workspacePath: "/remote/bot",
      workspaceId: "ws-1",
      projectId: "prj-1",
      template: { directory: "/remote/bot", created: ["AGENTS.md"], skipped: [] },
    })),
    addChannel: vi.fn(async (input) => ({
      channel: input.channel,
      account: input.account,
      installed: true,
      revision: true,
      transport: "started",
      owner: { ready: true },
      connectionId: "connection-1",
    })),
    channelStatus: async () => [],
    readManifest: readBotManifest,
    writeManifest: writeBotManifest,
  };
  return {
    home,
    deps,
    input: { home, env: {}, options: { provider: "codex", telegramBotToken: "secret-token" } },
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

describe("daemon-owned Bot onboarding", () => {
  it("uses daemon ids for channel setup and persists only a restart reference", async () => {
    const f = await fixture();
    try {
      await runBotStart(f.input, f.deps);
      expect(f.deps.provisionBot).toHaveBeenCalledOnce();
      expect(f.deps.addChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          setup: expect.objectContaining({ projectId: "prj-1", cwd: "/remote/bot" }),
        }),
      );
      const disk = JSON.parse(
        await readFile(path.join(f.home, "bots/personal-assistant.json"), "utf8"),
      );
      expect(disk).toMatchObject({
        version: 2,
        botId: "bot_1234567890123456",
        connectionId: "connection-1",
      });
      expect(disk).not.toHaveProperty("workspacePath");
      expect(disk).not.toHaveProperty("agentId");
      expect(JSON.stringify(disk)).not.toContain("secret-token");
    } finally {
      await f.cleanup();
    }
  });
  it("checkpoints the bot before a failed channel installation and closes the client", async () => {
    const f = await fixture();
    f.deps.addChannel = async () => {
      throw new Error("channel unavailable");
    };
    try {
      await expect(runBotStart(f.input, f.deps)).rejects.toThrow("channel unavailable");
      expect((await readBotManifest(f.home, "personal-assistant"))?.botId).toBe(
        "bot_1234567890123456",
      );
      expect(f.deps.closeDaemon).toHaveBeenCalledOnce();
    } finally {
      await f.cleanup();
    }
  });
  it("adopts a v1 manifest at its exact directory and writes v2", async () => {
    const f = await fixture();
    try {
      await writeBotManifest(f.home, {
        version: 1,
        name: "personal-assistant",
        botType: "team",
        provider: "codex",
        workspacePath: "/legacy/team",
        workspaceId: "old-ws",
        agentId: "old-agent",
        agentTitle: "Legacy",
        channel: "telegram",
        account: "legacy",
        connectionId: "old-connection",
        credentials: {},
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });
      await runBotStart({ ...f.input, options: { botName: "personal-assistant" } }, f.deps);
      expect(f.deps.provisionBot).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspacePath: "/legacy/team", botType: "team" }),
        undefined,
      );
      expect((await readBotManifest(f.home, "personal-assistant"))?.version).toBe(2);
    } finally {
      await f.cleanup();
    }
  });
  it("bare hub init keeps the shipped default path but named Bots let the daemon choose", async () => {
    const f = await fixture();
    try {
      await initializeAssistantWorkspace({}, f.home, f.deps, {});
      expect(f.deps.provisionBot).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ workspacePath: path.join(f.home, "workspaces/default") }),
      );
      await initializeAssistantWorkspace({ botName: "CEO" }, f.home, f.deps, {});
      expect(f.deps.provisionBot).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ workspacePath: "" }),
      );
    } finally {
      await f.cleanup();
    }
  });
});

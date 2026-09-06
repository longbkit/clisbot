import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { initializeAssistantWorkspace } from "./init.js";
import { runBotStart, type BotStartDeps } from "./run.js";
import { readBotManifest, writeBotManifest } from "./manifest.js";
import { seedWorkspaceTemplate } from "./workspace-template.js";
import type { ChannelAddInput } from "../channels/client.js";

async function fixture(overrides: Partial<BotStartDeps> = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "bot-onboarding-"));
  const calls: string[] = [];
  const inputs: ChannelAddInput[] = [];
  const directory = path.join(home, "workspaces", "default");
  const deps: BotStartDeps = {
    ensureHubUp: async () => {
      calls.push("hub");
      return { hub: "started", url: "http://localhost:6868" };
    },
    waitHubReady: async () => {},
    ensureDaemonUp: async () => {
      calls.push("daemon");
      return { daemon: "started" };
    },
    waitDaemonUp: async () => {},
    daemonHost: () => "localhost:6767",
    daemonPassword: () => undefined,
    openDaemon: async () => ({}) as DaemonClient,
    closeDaemon: async () => {},
    prepareOnboarding: async () => ({ daemonId: "daemon-1", ownerEmail: "owner@example.com" }),
    providerKnown: async () => true,
    findWorkspace: async () => ({ projectId: "prj-1", directory }),
    createWorkspace: async () => {
      calls.push("workspace");
      return { id: "ws-1", projectId: "prj-1", directory };
    },
    seedTemplate: async (cwd, type, overwrite) => {
      calls.push("seed");
      return seedWorkspaceTemplate(cwd, type, overwrite);
    },
    createIdleAgent: async () => {
      calls.push("agent");
      return { id: "agent-1" };
    },
    ensureWorkspaceDir: async () => {},
    addChannel: async (input) => {
      inputs.push(input);
      return {
        channel: input.channel,
        account: input.account,
        installed: true,
        revision: true,
        transport: "started",
        owner: { ready: true },
        connectionId: "connection-1",
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
    readManifest: readBotManifest,
    writeManifest: writeBotManifest,
    ...overrides,
  };
  const input = { home, env: {}, options: { provider: "codex", telegramBotToken: "test-token" } };
  return {
    home,
    calls,
    inputs,
    deps,
    input,
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

describe("API-first bot onboarding", () => {
  it("applies template overwrite only to the requested invocation when resuming a saved bot", async () => {
    const f = await fixture();
    try {
      const first = await runBotStart(f.input, f.deps);
      await writeFile(path.join(first.workspacePath, "USER.md"), "Saved owner context");
      const overwritten = await runBotStart(
        { ...f.input, options: { ...f.input.options, overwriteTemplate: true } },
        f.deps,
      );
      expect(overwritten.reused).toBe(true);
      expect(overwritten.template?.overwritten).toContain("USER.md");
      expect(
        await readFile(path.join(overwritten.template!.backupDirectory!, "USER.md"), "utf8"),
      ).toBe("Saved owner context");
      await writeFile(path.join(first.workspacePath, "USER.md"), "New owner context");
      const resumed = await runBotStart(f.input, f.deps);
      expect(resumed.template?.overwritten).toBeUndefined();
      expect(await readFile(path.join(first.workspacePath, "USER.md"), "utf8")).toBe(
        "New owner context",
      );
    } finally {
      await f.cleanup();
    }
  });
  it("seeds before provider startup and installs a usable owner route without hub init or deploy", async () => {
    const f = await fixture();
    try {
      const report = await runBotStart(f.input, f.deps);
      expect(f.calls).toEqual(["daemon", "hub", "workspace", "seed", "agent"]);
      expect(report.template?.created).toContain("AGENTS.md");
      expect(report.ownerReady).toBe(true);
      expect(f.inputs[0]?.setup).toMatchObject({
        projectId: "prj-1",
        cwd: report.workspacePath,
        provider: "codex",
      });
      expect(report.routeNote).not.toContain("add a");
      const manifest = await readBotManifest(f.home, "personal-assistant");
      expect(manifest?.projectId).toBe("prj-1");
      expect(JSON.stringify(manifest)).not.toContain("test-token");
    } finally {
      await f.cleanup();
    }
  });

  it("retains the seeded assistant when the owner has not finished Account setup", async () => {
    const f = await fixture();
    try {
      f.deps.prepareOnboarding = async () => {
        throw new Error("Finish Account setup");
      };
      await expect(runBotStart(f.input, f.deps)).rejects.toThrow("Finish Account setup");
      expect(f.calls).toContain("seed");
      expect((await readBotManifest(f.home, "personal-assistant"))?.projectId).toBe("prj-1");
      expect(f.inputs).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("retries a failed Channel install without duplicating the workspace or agent", async () => {
    const f = await fixture();
    try {
      const add = f.deps.addChannel;
      f.deps.addChannel = async () => {
        throw new Error("revision conflict");
      };
      await expect(runBotStart(f.input, f.deps)).rejects.toThrow("revision conflict");
      expect((await readBotManifest(f.home, "personal-assistant"))?.credentials).toEqual({});
      f.deps.addChannel = add;
      const report = await runBotStart(f.input, f.deps);
      expect(report.reused).toBe(true);
      expect(f.calls.filter((call) => call === "workspace")).toHaveLength(1);
      expect(f.calls.filter((call) => call === "agent")).toHaveLength(1);
      expect(report.template?.created).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it("reports owner verification as pending and carries only the explicit operator identity", async () => {
    const f = await fixture({
      addChannel: async () => ({
        channel: "telegram",
        account: "personal-assistant",
        installed: true,
        revision: true,
        transport: "started",
        owner: {
          ready: false,
          command: "link one-time-code",
          expiresAt: "2026-09-06T12:10:00.000Z",
        },
      }),
    });
    try {
      const report = await runBotStart(f.input, f.deps);
      expect(report.ownerReady).toBe(false);
      expect(report.ownerLinkCommand).toBe("link one-time-code");
      expect(report.ownerLinkExpiresAt).toBe("2026-09-06T12:10:00.000Z");
      expect(report.ownerLinkRenewCommand).toContain(`--home '${f.home}'`);
      expect(report.nextStep).toContain("linking command");
    } finally {
      await f.cleanup();
    }
  });

  it("seeds the directory returned by the daemon for a worktree", async () => {
    const f = await fixture();
    try {
      const directory = path.join(f.home, "actual-worktree");
      f.deps.createWorkspace = async () => ({ id: "ws-worktree", projectId: "prj-1", directory });
      const report = await runBotStart(
        { ...f.input, options: { ...f.input.options, newWorkspace: "worktree" } },
        f.deps,
      );
      expect(report.workspacePath).toBe(directory);
      expect(report.template?.directory).toBe(directory);
      expect(f.inputs[0]?.setup?.cwd).toBe(directory);
      expect((await readBotManifest(f.home, "personal-assistant"))?.sourcePath).toBe(
        path.join(f.home, "workspaces", "default"),
      );
    } finally {
      await f.cleanup();
    }
  });

  it("runs channel-less hub init with the default provider and seeds before the agent", async () => {
    const f = await fixture();
    try {
      const report = await initializeAssistantWorkspace(
        { provider: undefined },
        f.home,
        f.deps,
        {},
      );
      expect(report.projectId).toBe("prj-1");
      expect(f.calls).toEqual(["daemon", "workspace", "seed", "agent", "hub"]);
      expect(f.inputs).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("reuses its encrypted Connection without resupplying a token, including after a failed retry", async () => {
    const f = await fixture();
    try {
      await runBotStart(f.input, f.deps);
      const add = f.deps.addChannel;
      f.deps.addChannel = async () => {
        throw new Error("temporary failure");
      };
      await expect(runBotStart({ ...f.input, options: {} }, f.deps)).rejects.toThrow(
        "temporary failure",
      );
      f.deps.addChannel = add;
      const report = await runBotStart({ ...f.input, options: {} }, f.deps);
      expect(report.reused).toBe(true);
      expect(f.inputs.at(-1)).toMatchObject({ channel: "telegram", connectionId: "connection-1" });
      expect(f.inputs.at(-1)).not.toHaveProperty("botToken");
      expect(f.inputs.at(-1)?.setup?.update).toBe(false);
      expect(f.calls.filter((c) => c === "agent")).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });

  it("keeps template and enrollment effects off with the rollout disabled", async () => {
    const f = await fixture({
      prepareOnboarding: async () => {
        throw new Error("unexpected onboarding");
      },
    });
    try {
      const report = await runBotStart(
        { ...f.input, env: { CLISBOT_ONBOARDING_ENABLED: "0" } },
        f.deps,
      );
      expect(f.calls).not.toContain("seed");
      expect(f.inputs[0]?.setup).toBeUndefined();
      expect(report.template).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
});

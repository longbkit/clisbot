import { describe, it, expect } from "vitest";
import { runBotStart, selectExistingBot, type BotStartDeps } from "./run.js";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { BotPayload } from "@clisbot/protocol/bots/types";

const bot: BotPayload = {
  id: "bot_1234567890123456",
  name: "Sandbox Assistant",
  slug: "sandbox-assistant",
  kind: "personal",
  launch: { provider: "codex" },
  cwd: "/isolated/bot",
  projectId: "prj",
  workspaceId: "wks",
  owner: { kind: "system", id: "owner" },
  template: null,
  archivedAt: null,
  createdAt: "now",
  updatedAt: "now",
};
function fixture() {
  const calls: string[] = [];
  const client = {
    getLastServerInfoMessage: () => ({ features: { bots: true } }),
    listBots: async () => ({ bots: [bot], error: null }),
  } as unknown as DaemonClient;
  const unexpected = async (): Promise<never> => {
    throw new Error("Channel-free setup touched Hub or credentials");
  };
  const deps: BotStartDeps = {
    ensureHubUp: unexpected,
    waitHubReady: unexpected,
    prepareOnboarding: unexpected,
    addChannel: unexpected,
    channelStatus: unexpected,
    ensureDaemonUp: async () => ({ daemon: "already-running" }),
    waitDaemonUp: async () => {},
    daemonHost: () => "127.0.0.1:19001",
    daemonPassword: () => undefined,
    openDaemon: async () => client,
    closeDaemon: async () => {
      calls.push("closed");
    },
    readManifest: async () => null,
    writeManifest: unexpected,
    provisionBot: async (_client, plan, id) => {
      calls.push(id ?? "created");
      expect(plan.provider).toBe("codex");
      return {
        botId: bot.id,
        agentId: "",
        agentTitle: plan.name,
        workspacePath: bot.cwd,
        workspaceId: bot.workspaceId,
        projectId: bot.projectId,
      };
    },
  };
  return { calls, deps };
}
describe("default-first Bot startup", () => {
  it("creates a channel-free Bot without Hub, identity, credentials or manifest", async () => {
    const f = fixture();
    const result = await runBotStart(
      { home: "/isolated", env: {}, options: { botName: bot.name, provider: "codex" } },
      f.deps,
    );
    expect(result).toMatchObject({ channel: "-", hub: "not-required", credential: "not-required" });
    expect(f.calls).toEqual(["created", "closed"]);
  });
  it("selects an existing Bot by name and reuses its identity and launch defaults", async () => {
    const f = fixture();
    const result = await runBotStart(
      { home: "/isolated", env: {}, options: { selector: bot.name } },
      f.deps,
    );
    expect(result.reused).toBe(true);
    expect(f.calls).toEqual(["closed", bot.id, "closed"]);
  });
  it("rejects unknown and ambiguous selectors without creating a Bot", () => {
    expect(() => selectExistingBot([bot], "unknown")).toThrow("No existing Bot");
    expect(() =>
      selectExistingBot([bot, { ...bot, id: "bot_aaaaaaaaaaaaaaaa" }], bot.name),
    ).toThrow("ambiguous");
    expect(selectExistingBot([bot], bot.id).id).toBe(bot.id);
    expect(selectExistingBot([bot], bot.slug).id).toBe(bot.id);
  });
});

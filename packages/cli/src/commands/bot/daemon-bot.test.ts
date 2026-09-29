import { describe, it, expect, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { BotPayload } from "@clisbot/protocol/bots/types";
import { provisionDaemonBot, listDaemonBots } from "./daemon-bot.js";
import { buildAssistantPlan } from "./plan.js";

const bot: BotPayload = {
  id: "bot_1234567890123456",
  slug: "ceo",
  name: "CEO",
  kind: "personal",
  projectId: "prj_1",
  workspaceId: "wks_1",
  cwd: "/host/bots/ceo",
  launch: { provider: "codex" },
  template: null,
  owner: { kind: "system", id: "test" },
  createdAt: "now",
  updatedAt: "now",
  archivedAt: null,
};
function client(enabled = true) {
  const api = {
    getLastServerInfoMessage: () => ({ features: { bots: enabled } }),
    createBot: vi.fn(async () => ({
      bot,
      error: null,
      reused: false,
      template: { created: ["AGENTS.md"], skipped: [] },
    })),
    listBots: vi.fn(async () => ({ bots: [bot], error: null })),
    updateBot: vi.fn(async () => ({ bot, error: null })),
    seedBotTemplate: vi.fn(async () => ({
      bot,
      error: null,
      template: { created: [], skipped: ["AGENTS.md"] },
    })),
  };
  return { api, client: api as unknown as DaemonClient };
}
const plan = () => buildAssistantPlan({ botName: "CEO", provider: "codex" }, "/local/home");

describe("Bot RPC boundary", () => {
  it("lets the Host choose the home and does not create an agent", async () => {
    const f = client();
    const result = await provisionDaemonBot(f.client, plan());
    expect(f.api.createBot).toHaveBeenCalledWith(
      expect.not.objectContaining({ path: expect.anything() }),
    );
    expect(result.workspacePath).toBe("/host/bots/ceo");
    expect(result.botId).toBe(bot.id);
    expect(result.agentId).toBe("");
  });
  it("rejects an old or disabled Host before mutating anything", async () => {
    const f = client(false);
    await expect(provisionDaemonBot(f.client, plan())).rejects.toThrow(
      "enable daemon.bots.enabled",
    );
    expect(f.api.createBot).not.toHaveBeenCalled();
    await expect(listDaemonBots(f.client)).rejects.toThrow("Update the Host");
  });
  it("adopts a legacy directory through the Host and preserves overwrite intent", async () => {
    const f = client();
    await provisionDaemonBot(f.client, {
      ...plan(),
      workspacePath: "/legacy/home",
      overwriteTemplate: true,
    });
    expect(f.api.createBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/legacy/home", template: { overwrite: true } }),
    );
  });
  it("resumes by durable Bot id and rejects moving its home", async () => {
    const f = client();
    await provisionDaemonBot(f.client, plan(), bot.id);
    expect(f.api.createBot).not.toHaveBeenCalled();
    expect(f.api.seedBotTemplate).toHaveBeenCalledWith({ botId: bot.id, overwrite: undefined });
    await expect(
      provisionDaemonBot(f.client, { ...plan(), workspacePath: "/other" }, bot.id),
    ).rejects.toThrow("home cannot move");
    await expect(provisionDaemonBot(f.client, plan(), "missing")).rejects.toThrow(
      "missing or archived",
    );
  });
});

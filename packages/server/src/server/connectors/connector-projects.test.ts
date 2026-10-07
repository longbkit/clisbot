import { describe, expect, it } from "vitest";
import type { StoredBot } from "@clisbot/protocol/bots/types";
import type { BotService } from "../bots/index.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import { createConnectorProjectDirectory } from "./connector-projects.js";

const project = (projectId: string, rootPath: string, archivedAt: string | null = null) => ({
  projectId,
  rootPath,
  kind: "git" as const,
  displayName: projectId,
  projectKey: null,
  customName: null,
  customIconRevision: null,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  archivedAt,
});

const workspace = (workspaceId: string, projectId: string, cwd: string) => ({
  workspaceId,
  projectId,
  cwd,
  archivedAt: null,
});

function directoryWith(bots: Partial<StoredBot>[]) {
  const projects = [
    project("prj_app", "/code/app"),
    project("prj_old", "/code/old", "2026-10-01T00:00:00.000Z"),
    project("prj_bot", "/bots/gone"),
  ];
  const workspaces = [
    workspace("w1", "prj_app", "/code/app"),
    workspace("w2", "prj_app", "/code/app-worktrees/feature"),
    workspace("w3", "prj_old", "/code/old"),
    workspace("w4", "prj_bot", "/bots/gone"),
  ];
  return createConnectorProjectDirectory({
    projectRegistry: {
      get: async (id: string) => projects.find((entry) => entry.projectId === id) ?? null,
    } as unknown as ProjectRegistry,
    workspaceRegistry: { list: async () => workspaces } as unknown as WorkspaceRegistry,
    botService: {
      list: async () => bots,
      subscribe: () => () => undefined,
    } as unknown as BotService,
    agentLabels: () => undefined,
    agentCwd: () => undefined,
    agentState: () => "active",
  });
}

describe("connector Project directory", () => {
  it("adds the Chat's off list to a Bot session's own, and only to its Chat's sessions", async () => {
    const labels: Record<string, Record<string, string>> = {
      chat: { "clisbot.chat-id": "cht_1", "clisbot.connectors-off": "gmail" },
      plain: { "clisbot.connectors-off": "slack" },
    };
    const directory = createConnectorProjectDirectory({
      projectRegistry: { get: async () => null } as unknown as ProjectRegistry,
      workspaceRegistry: { list: async () => [] } as unknown as WorkspaceRegistry,
      botService: null,
      agentLabels: (agentId) => labels[agentId],
      agentCwd: () => undefined,
      agentState: () => "active",
      chatToolsOff: async (chatId) => (chatId === "cht_1" ? ["tools:browser", "notion"] : []),
    });
    expect([...(await directory.offList("chat"))].sort()).toEqual([
      "gmail",
      "notion",
      "tools:browser",
    ]);
    expect([...(await directory.offList("plain"))]).toEqual(["slack"]);
    // A Bot session's allows include its Chat's, which outlast `/new`.
    expect(directory.allowOwners("chat")).toEqual(["chat", "chat:cht_1"]);
    expect(directory.allowOwners("plain")).toEqual(["plain"]);
  });

  it("puts a session in the Project of its Workspace, worktrees included", async () => {
    const directory = directoryWith([]);
    expect(await directory.projectForCwd("/code/app")).toEqual({
      projectId: "prj_app",
      rootPath: "/code/app",
    });
    expect((await directory.projectForCwd("/code/app-worktrees/feature"))?.projectId).toBe(
      "prj_app",
    );
    expect(await directory.projectForCwd("/somewhere/else")).toBeNull();
  });

  it("gives an archived Project, or an archived Bot's Project, nothing", async () => {
    const directory = directoryWith([{ projectId: "prj_bot", archivedAt: "2026-10-02T00:00:00Z" }]);
    expect(await directory.projectForCwd("/code/old")).toBeNull();
    expect(await directory.projectForCwd("/bots/gone")).toBeNull();
    expect(
      await directoryWith([{ projectId: "prj_bot", archivedAt: null }]).project("prj_bot"),
    ).not.toBeNull();
  });
});

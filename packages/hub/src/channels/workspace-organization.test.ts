// Workspace organization (docs/features/workspace-organization/README.md):
// which workspace a channel session lands in (A1/A3/A5) and the flag that
// returns every decision to the daemon (A6).
import { describe, expect, it, vi } from "vitest";
import type { DaemonConnection } from "./daemon/client.js";
import type { AgentSnapshot } from "./daemon/types.js";
import type { InboundMessage, PlaneLogger } from "./plane/types.js";
import { resolveSessionWorkspaceId } from "./workspace-organization.js";

const SILENT: PlaneLogger = { warn: () => undefined };

const SOURCE: InboundMessage = {
  channel: "slack",
  accountId: "work",
  senderIdentity: "slack:U1",
  text: "ship the login fix",
  mentionedBot: true,
  conversation: { kind: "thread", id: "C1", rootConversationId: "C1", threadId: "T1" },
};

function agent(id: string, workspaceId?: string): AgentSnapshot {
  return {
    id,
    provider: "codex",
    cwd: "/repo",
    title: null,
    status: "idle",
    createdAt: "",
    updatedAt: "",
    labels: {},
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

function fakeDaemon(options: { agents?: AgentSnapshot[]; multiplicity?: boolean } = {}) {
  const listAgents = vi.fn(async () => options.agents ?? []);
  const createWorkspace = vi.fn(async () => ({ workspaceId: "workspace-new" }));
  const daemon = {
    listAgents,
    createWorkspace,
    getServerInfo: () => ({
      serverId: "daemon",
      features: { workspaceMultiplicity: options.multiplicity ?? true },
    }),
  } as unknown as DaemonConnection;
  return { daemon, listAgents, createWorkspace };
}

describe("workspace organization", () => {
  it("sends no workspace and touches the daemon when organization is off (A6)", async () => {
    const f = fakeDaemon({ agents: [agent("source", "workspace-source")] });
    const resolved = await resolveSessionWorkspaceId(f.daemon, {
      organize: false,
      sourceAgentId: "source",
      cwd: "/repo",
      firstAgentContext: { prompt: "ship the login fix" },
    });
    expect(resolved).toBeUndefined();
    expect(f.listAgents).not.toHaveBeenCalled();
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });

  it("organizes when the knob is unauthored: absence is the floor and reads as on (A6)", async () => {
    const f = fakeDaemon({ agents: [agent("source", "workspace-source")] });
    expect(
      await resolveSessionWorkspaceId(f.daemon, {
        organize: undefined,
        sourceAgentId: "source",
        cwd: "/repo",
      }),
    ).toBe("workspace-source");
  });

  it("continues the source session in its own workspace without renaming it (A1/A5)", async () => {
    const f = fakeDaemon({ agents: [agent("other"), agent("source", "workspace-source")] });
    const resolved = await resolveSessionWorkspaceId(f.daemon, {
      organize: true,
      sourceAgentId: "source",
      cwd: "/repo",
      firstAgentContext: { prompt: "ship the login fix" },
    });
    expect(resolved).toBe("workspace-source");
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });

  it("leaves placement to the daemon when the source session reports no workspace", async () => {
    const f = fakeDaemon({ agents: [agent("source")] });
    const warn = vi.fn();
    expect(
      await resolveSessionWorkspaceId(f.daemon, {
        organize: true,
        sourceAgentId: "source",
        cwd: "/repo",
        logger: { warn },
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("creates the new session's workspace with the first request as naming context (A3)", async () => {
    const f = fakeDaemon();
    const resolved = await resolveSessionWorkspaceId(f.daemon, {
      organize: true,
      cwd: "/repo",
      projectId: "project-1",
      firstAgentContext: { prompt: "  ship the login fix  " },
      source: SOURCE,
      logger: SILENT,
    });
    expect(resolved).toBe("workspace-new");
    expect(f.createWorkspace).toHaveBeenCalledWith(
      {
        cwd: "/repo",
        projectId: "project-1",
        firstAgentContext: { prompt: "ship the login fix" },
      },
      { source: SOURCE },
    );
  });

  it("creates no workspace without a naming seed", async () => {
    const f = fakeDaemon();
    expect(
      await resolveSessionWorkspaceId(f.daemon, { organize: true, cwd: "/repo" }),
    ).toBeUndefined();
    expect(
      await resolveSessionWorkspaceId(f.daemon, {
        organize: true,
        cwd: "/repo",
        firstAgentContext: { prompt: "   " },
      }),
    ).toBeUndefined();
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });

  it("creates no workspace on a daemon without workspaceMultiplicity", async () => {
    const f = fakeDaemon({ multiplicity: false });
    expect(
      await resolveSessionWorkspaceId(f.daemon, {
        organize: true,
        cwd: "/repo",
        firstAgentContext: { prompt: "ship the login fix" },
      }),
    ).toBeUndefined();
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });

  it("falls back to daemon placement when workspace creation fails", async () => {
    const f = fakeDaemon();
    f.createWorkspace.mockRejectedValueOnce(new Error("directory not found"));
    const warn = vi.fn();
    expect(
      await resolveSessionWorkspaceId(f.daemon, {
        organize: true,
        cwd: "/repo",
        firstAgentContext: { prompt: "ship the login fix" },
        logger: { warn },
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

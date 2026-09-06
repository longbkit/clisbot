import { execFileSync } from "node:child_process";
import { getPaseoWorktreesRoot } from "../../utils/worktree.js";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SessionAuthorization } from "../authorization/index.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import type { ProjectAuthorization, ProjectPrivilege } from "./types.js";
import { ManagedResourceAuthorizer } from "./resource-authorizer.js";

function project(projectId: string, rootPath: string): PersistedProjectRecord {
  return {
    projectId,
    rootPath,
    kind: "git",
    displayName: projectId,
    projectKey: null,
    customName: null,
    customIconRevision: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function workspace(workspaceId: string, projectId: string, cwd: string): PersistedWorkspaceRecord {
  return {
    workspaceId,
    projectId,
    cwd,
    kind: "local_checkout",
    displayName: workspaceId,
    title: null,
    branch: null,
    worktreeRoot: cwd,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: cwd,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    autoArchivedChangeRequestUrl: null,
    pinnedAt: null,
  };
}

function createHarness(
  privileges: readonly ProjectPrivilege[],
  paths: { projectA?: string; projectB?: string } = {},
) {
  const projectA = paths.projectA ?? "/work/a";
  const projectB = paths.projectB ?? "/work/b";
  const projects = [project("project-a", projectA), project("project-b", projectB)];
  const workspaces = [
    workspace("workspace-a", "project-a", projectA),
    workspace("workspace-b", "project-b", projectB),
  ];
  const records = new Map<string, StoredAgentRecord>([
    [
      "agent-a",
      {
        id: "agent-a",
        provider: "codex",
        cwd: projectA,
        workspaceId: "workspace-a",
        config: {
          provider: "codex",
          cwd: projectA,
          model: "gpt-5.6",
          thinkingOptionId: "high",
        },
        persistence: { provider: "codex", sessionId: "session-a" },
      } as StoredAgentRecord,
    ],
    [
      "agent-b",
      {
        id: "agent-b",
        provider: "codex",
        cwd: projectB,
        workspaceId: "workspace-b",
        config: { provider: "codex", cwd: projectB },
        persistence: { provider: "codex", sessionId: "session-b" },
      } as StoredAgentRecord,
    ],
    [
      "agent-legacy",
      {
        id: "agent-legacy",
        provider: "codex",
        cwd: "/legacy",
        config: { provider: "codex", cwd: "/legacy" },
      } as StoredAgentRecord,
    ],
  ]);
  const pending = new Map([
    [
      "file-request",
      {
        id: "file-request",
        provider: "codex",
        name: "CodexFileChange",
        kind: "tool",
      },
    ],
    [
      "command-request",
      {
        id: "command-request",
        provider: "codex",
        name: "CodexBash",
        kind: "tool",
        input: { command: "git reset --hard HEAD~1" },
      },
    ],
  ]);
  const projectAuthorization: ProjectAuthorization = {
    privileges: new Set(privileges),
    agentConfigurations: [
      {
        providerId: "codex",
        modelIds: ["gpt-5.6"],
        thinkingOptionIds: ["high"],
      },
    ],
  };
  const authorization = new SessionAuthorization([], {
    resourceMode: "projects",
    projects: new Map([["project-a", projectAuthorization]]),
    leaseId: "00000000-0000-4000-8000-000000000001",
    leaseExpiresAt: Date.now() + 60_000,
  });
  const projectRegistry = {
    list: async () => projects,
    get: async (id: string) => projects.find((candidate) => candidate.projectId === id) ?? null,
  } as ProjectRegistry;
  const workspaceRegistry = {
    list: async () => workspaces,
    get: async (id: string) => workspaces.find((candidate) => candidate.workspaceId === id) ?? null,
  } as WorkspaceRegistry;
  const agentManager = {
    getAgent: () => null,
    listAgents: () => [],
    getPendingPermissions: () => [...pending.values()],
  } as unknown as AgentManager;
  const agentStorage = {
    list: async () => [...records.values()],
    get: async (id: string) => records.get(id) ?? null,
    listByProviderSession: async (provider: string, providerHandleId: string) =>
      [...records.values()].filter(
        (record) =>
          record.persistence?.provider === provider &&
          record.persistence.sessionId === providerHandleId,
      ),
  };
  const terminalManager = {
    getTerminal: (id: string) => {
      if (id === "terminal-a") {
        return { id, workspaceId: "workspace-a" } as ReturnType<TerminalManager["getTerminal"]>;
      }
      if (id === "terminal-b") {
        return { id, workspaceId: "workspace-b" } as ReturnType<TerminalManager["getTerminal"]>;
      }
      return undefined;
    },
  } as TerminalManager;
  const agentConfigurationSafety = {
    isUnattendedConfiguration: async (config: {
      modeId?: string;
      featureValues?: Record<string, unknown>;
    }) => config.modeId === "unattended" || config.featureValues?.auto_accept === true,
  };

  return new ManagedResourceAuthorizer(
    authorization,
    projectRegistry,
    workspaceRegistry,
    agentManager,
    agentStorage,
    terminalManager,
    agentConfigurationSafety,
  );
}

describe("ManagedResourceAuthorizer", () => {
  it("resolves Agent ownership through Workspace and fails closed for legacy records", async () => {
    const authorizer = createHarness(["project.use", "agent.interact"]);
    await expect(
      authorizer.allowsInbound({
        type: "fetch_agent_request",
        requestId: "request-a",
        agentId: "agent-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "fetch_agent_request",
        requestId: "request-b",
        agentId: "agent-b",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "fetch_agent_request",
        requestId: "request-legacy",
        agentId: "agent-legacy",
      }),
    ).resolves.toBe(false);
  });

  it("checks explicit Agent configuration and Fast mode at creation", async () => {
    const authorizer = createHarness(["project.use", "agent.create"]);
    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-allowed",
        workspaceId: "workspace-a",
        config: {
          provider: "codex",
          cwd: "/work/a",
          model: "gpt-5.6",
          thinkingOptionId: "high",
        },
        labels: {},
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-fast",
        workspaceId: "workspace-a",
        config: {
          provider: "codex",
          cwd: "/work/a",
          model: "gpt-5.6",
          thinkingOptionId: "high",
          featureValues: { fast_mode: true },
        },
        labels: {},
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-cwd-escape",
        workspaceId: "workspace-a",
        config: {
          provider: "codex",
          cwd: "/work/b",
          model: "gpt-5.6",
          thinkingOptionId: "high",
        },
        labels: {},
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when an Agent create request names the wrong Project", async () => {
    const authorizer = createHarness(["project.use", "agent.create"]);
    const config = {
      provider: "codex",
      cwd: "/work/a/new-checkout",
      model: "gpt-5.6",
      thinkingOptionId: "high",
    } as const;

    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-project-allowed",
        projectId: "project-a",
        config,
        labels: {},
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-project-ungranted",
        projectId: "project-b",
        config,
        labels: {},
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "create_agent_request",
        requestId: "create-project-workspace-mismatch",
        projectId: "project-a",
        workspaceId: "workspace-b",
        config: { ...config, cwd: "/work/b" },
        labels: {},
      }),
    ).resolves.toBe(false);
  });

  it("requires the complete approval grant for unattended configurations", async () => {
    const limited = createHarness([
      "project.use",
      "agent.create",
      "agent.interact",
      "approval.file",
    ]);
    await expect(
      limited.allowsInbound({
        type: "create_agent_request",
        requestId: "create-unattended",
        workspaceId: "workspace-a",
        config: {
          provider: "codex",
          cwd: "/work/a",
          model: "gpt-5.6",
          thinkingOptionId: "high",
          modeId: "unattended",
        },
        labels: {},
      }),
    ).resolves.toBe(false);
    await expect(
      limited.allowsInbound({
        type: "set_agent_mode_request",
        requestId: "set-unattended",
        agentId: "agent-a",
        modeId: "unattended",
      }),
    ).resolves.toBe(false);
    await expect(
      limited.allowsInbound({
        type: "agent.config.apply.request",
        requestId: "apply-auto-accept",
        agentId: "agent-a",
        config: { featureValues: { auto_accept: true } },
      }),
    ).resolves.toBe(false);

    const full = createHarness([
      "project.use",
      "agent.create",
      "agent.interact",
      "approval.file",
      "approval.config",
      "approval.command",
      "approval.command.destructive",
      "approval.channel",
    ]);
    await expect(
      full.allowsInbound({
        type: "set_agent_mode_request",
        requestId: "set-unattended",
        agentId: "agent-a",
        modeId: "unattended",
      }),
    ).resolves.toBe(true);
  });

  it("projects Provider catalogs and denies daemon-global reads", async () => {
    const authorizer = createHarness(["project.use", "agent.create"]);
    await expect(
      authorizer.allowsInbound({
        type: "ping",
        requestId: "ping",
        clientSentAt: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "diagnostics.request",
        requestId: "diagnostics",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "provider.usage.list.request",
        requestId: "usage",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "list_provider_models_request",
        provider: "codex",
        cwd: "/work/a",
        requestId: "models-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "list_provider_models_request",
        provider: "claude",
        cwd: "/work/a",
        requestId: "models-ungranted-provider",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "list_provider_models_request",
        provider: "codex",
        cwd: "/work/b",
        requestId: "models-ungranted-project",
      }),
    ).resolves.toBe(false);

    await authorizer.ready();
    const projected = authorizer.filterProviderCatalogEntries(
      [
        {
          provider: "codex",
          status: "ready",
          enabled: true,
          models: [
            {
              provider: "codex",
              id: "gpt-5.6",
              label: "GPT-5.6",
              defaultThinkingOptionId: "low",
              thinkingOptions: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            },
            {
              provider: "codex",
              id: "gpt-other",
              label: "Other",
            },
          ],
          modes: [
            { id: "safe", label: "Safe" },
            { id: "unattended", label: "Unattended", isUnattended: true },
          ],
        },
        {
          provider: "claude",
          status: "ready",
          enabled: true,
          models: [],
          modes: [],
        },
      ],
      "/work/a",
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]?.provider).toBe("codex");
    expect(projected[0]?.models?.map(({ id }) => id)).toEqual(["gpt-5.6"]);
    expect(projected[0]?.models?.[0]?.thinkingOptions).toEqual([{ id: "high", label: "High" }]);
    expect(projected[0]?.models?.[0]?.defaultThinkingOptionId).toBe("high");
    expect(projected[0]?.modes?.map(({ id }) => id)).toEqual(["safe"]);
  });

  it("applies Project boundaries to every cwd-bearing RPC and outbound update", async () => {
    const authorizer = createHarness(["project.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "checkout_status_request",
        cwd: "/work/a/subdirectory",
        requestId: "checkout-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "checkout_status_request",
        cwd: "/work/b",
        requestId: "checkout-b",
      }),
    ).resolves.toBe(false);
    expect(
      authorizer.allowsOutbound({
        type: "checkout_commit_response",
        payload: {
          cwd: "/work/a",
          success: true,
          error: null,
          requestId: "commit-a",
        },
      }),
    ).toBe(true);
    expect(
      authorizer.allowsOutbound({
        type: "checkout_commit_response",
        payload: {
          cwd: "/work/b",
          success: true,
          error: null,
          requestId: "commit-b",
        },
      }),
    ).toBe(false);
  });

  it("requires an exact active Workspace root for managed file operations", async () => {
    const authorizer = createHarness(["project.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "file_explorer_request",
        cwd: "/work/a",
        path: "src/index.ts",
        mode: "file",
        requestId: "file-root",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "file_explorer_request",
        cwd: "/work/a/nested",
        path: "secrets.txt",
        mode: "file",
        requestId: "file-nested-root",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "file_download_token_request",
        cwd: "/work/b",
        path: "secrets.txt",
        requestId: "file-other-project",
      }),
    ).resolves.toBe(false);
  });

  it("rejects a managed cwd whose symlink resolves into another Project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-managed-cwd-"));
    const projectA = path.join(root, "project-a");
    const projectB = path.join(root, "project-b");
    await Promise.all([mkdir(projectA), mkdir(projectB)]);
    const foreignLink = path.join(projectA, "foreign-link");
    await symlink(projectB, foreignLink, process.platform === "win32" ? "junction" : "dir");
    try {
      const authorizer = createHarness(["project.use", "terminal.use"], {
        projectA,
        projectB,
      });
      await expect(
        authorizer.allowsInbound({
          type: "create_terminal_request",
          cwd: foreignLink,
          requestId: "terminal-symlink-escape",
        }),
      ).resolves.toBe(false);
      await expect(
        authorizer.allowsInbound({
          type: "create_terminal_request",
          cwd: path.join(foreignLink, "not-created"),
          requestId: "terminal-symlink-new-child-escape",
        }),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("authorizes Project configuration by repoRoot", async () => {
    const authorizer = createHarness(["project.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "read_project_config_request",
        repoRoot: "/work/a",
        requestId: "config-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "write_project_config_request",
        repoRoot: "/work/b",
        config: {},
        requestId: "config-b",
      }),
    ).resolves.toBe(false);
  });

  it("requires a scoped root for path discovery and imported Provider sessions", async () => {
    const authorizer = createHarness(["project.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "directory_suggestions_request",
        query: "repo",
        requestId: "directory-global",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "directory_suggestions_request",
        query: "src",
        cwd: "/work/a",
        requestId: "directory-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "fetch_recent_provider_sessions_request",
        requestId: "sessions-global",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "import_agent_request",
        provider: "codex",
        providerHandleId: "external-session",
        cwd: "/work/a",
        workspaceId: "workspace-a",
        requestId: "import-unverifiable",
      }),
    ).resolves.toBe(false);
  });

  it("does not expose the daemon-wide Workspace label catalog", async () => {
    const authorizer = createHarness(["project.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "workspace.label.list.request",
        requestId: "labels",
        subscribe: { subscriptionId: "labels-subscription" },
      }),
    ).resolves.toBe(false);
  });

  it("resolves resume handles and revalidates configuration before starting an Agent", async () => {
    const authorizer = createHarness(["project.use", "agent.interact"]);
    await expect(
      authorizer.allowsInbound({
        type: "resume_agent_request",
        handle: { provider: "codex", sessionId: "session-a" },
        requestId: "resume-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "resume_agent_request",
        handle: { provider: "codex", sessionId: "session-b" },
        requestId: "resume-b",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "resume_agent_request",
        handle: { provider: "codex", sessionId: "session-a" },
        overrides: { model: "gpt-ungranted" },
        requestId: "resume-model",
      }),
    ).resolves.toBe(false);
  });

  it("checks every Agent and Workspace ID in batched requests", async () => {
    const authorizer = createHarness(["project.use", "agent.interact"]);
    await expect(
      authorizer.allowsInbound({
        type: "clear_agent_attention",
        agentId: ["agent-a", "agent-b"],
        requestId: "agents-mixed",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "workspace.clear_attention.request",
        workspaceId: ["workspace-a", "workspace-b"],
        requestId: "workspaces-mixed",
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "agent.timeline.set_subscription.request",
        agentIds: ["agent-a", "agent-b"],
        requestId: "timeline-mixed",
      }),
    ).resolves.toBe(false);
    expect(
      authorizer.allowsOutbound({
        type: "agent.timeline.set_subscription.response",
        payload: {
          agentIds: ["agent-a", "agent-b"],
          requestId: "timeline-mixed",
        },
      }),
    ).toBe(false);
  });

  it("filters nested Provider subagents and emits removals only for visible Agents", async () => {
    const authorizer = createHarness(["project.use"]);
    await authorizer.ready();
    expect(
      authorizer.allowsOutbound({
        type: "agent.provider_subagents.update",
        payload: {
          kind: "upsert",
          subagent: {
            id: "subagent-b",
            parentAgentId: "agent-b",
            provider: "codex",
            title: null,
            description: null,
            status: "running",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            toolCallId: null,
          },
        },
      }),
    ).toBe(false);

    expect(
      authorizer.allowsOutbound({
        type: "agent.timeline.replacement",
        payload: { agentId: "agent-a", epoch: "epoch-a" },
      }),
    ).toBe(true);
    expect(
      authorizer.allowsOutbound({
        type: "agent_update",
        payload: { kind: "remove", agentId: "agent-a" },
      }),
    ).toBe(true);
    expect(
      authorizer.allowsOutbound({
        type: "agent_update",
        payload: { kind: "remove", agentId: "agent-b" },
      }),
    ).toBe(false);
  });

  it("does not accept unauthorized focused resources through heartbeats", async () => {
    const authorizer = createHarness(["project.use", "terminal.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "client_heartbeat",
        deviceType: "web",
        focusedAgentId: "agent-a",
        focusedTerminalId: "terminal-a",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        appVisible: true,
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "client_heartbeat",
        deviceType: "web",
        focusedAgentId: "agent-b",
        focusedTerminalId: null,
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        appVisible: true,
      }),
    ).resolves.toBe(false);
  });

  it("does not expose the daemon-global browser host broker to a Project session", async () => {
    const authorizer = createHarness(["project.use", "agent.interact"]);
    await expect(
      authorizer.allowsInbound({
        type: "browser.automation.execute.response",
        payload: {
          requestId: "guessed-browser-request",
          ok: false,
          error: {
            code: "browser_execution_failed",
            message: "spoofed",
            retryable: false,
          },
        },
      }),
    ).resolves.toBe(false);
  });

  it("uses the classified approval leaf and treats deny as non-authorizing", async () => {
    const authorizer = createHarness(["project.use", "approval.file", "approval.command"]);
    await expect(
      authorizer.allowsInbound({
        type: "agent_permission_response",
        agentId: "agent-a",
        requestId: "file-request",
        response: { behavior: "allow" },
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "agent_permission_response",
        agentId: "agent-a",
        requestId: "command-request",
        response: { behavior: "allow" },
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.allowsInbound({
        type: "agent_permission_response",
        agentId: "agent-a",
        requestId: "command-request",
        response: { behavior: "deny" },
      }),
    ).resolves.toBe(true);
  });

  it("requires terminal.use for both terminal IDs and workspace-scoped creation", async () => {
    const authorizer = createHarness(["project.use", "terminal.use"]);
    await expect(
      authorizer.allowsInbound({
        type: "capture_terminal_request",
        terminalId: "terminal-a",
        requestId: "capture-a",
        stripAnsi: true,
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.allowsInbound({
        type: "capture_terminal_request",
        terminalId: "terminal-b",
        requestId: "capture-b",
        stripAnsi: true,
      }),
    ).resolves.toBe(false);
  });
});

describe("managed workspace.create", () => {
  it("requires the leaf and an explicit existing Project with an exact owned source root", async () => {
    const authorizer = createHarness(["project.use", "workspace.create"]);
    for (const source of [
      { kind: "directory" as const, projectId: "project-a", path: "/work/a" },
      { kind: "worktree" as const, projectId: "project-a" },
      { kind: "worktree" as const, projectId: "project-a", cwd: "/work/a" },
    ]) {
      await expect(
        authorizer.allowsInbound({
          type: "workspace.create.request",
          requestId: "allowed",
          source,
        }),
      ).resolves.toBe(true);
    }
    for (const source of [
      { kind: "directory" as const, path: "/work/a" },
      { kind: "directory" as const, projectId: "new-project", path: "/work/a" },
      { kind: "directory" as const, projectId: "project-b", path: "/work/b" },
      { kind: "directory" as const, projectId: "project-a", path: "/work/b" },
      { kind: "directory" as const, projectId: "project-a", path: "/work/a/child" },
      { kind: "worktree" as const, projectId: "project-b" },
      { kind: "worktree" as const, projectId: "project-a", cwd: "/work/b" },
      { kind: "worktree" as const, cwd: "/work/a" },
    ]) {
      await expect(
        authorizer.allowsInbound({
          type: "workspace.create.request",
          requestId: "denied",
          source,
        }),
      ).resolves.toBe(false);
    }
    await expect(
      createHarness(["project.use", "agent.create"]).allowsInbound({
        type: "workspace.create.request",
        requestId: "old-grant",
        source: { kind: "directory", projectId: "project-a", path: "/work/a" },
      }),
    ).resolves.toBe(false);
  });

  it("rejects symlink source and generated-destination escapes while allowing the normal worktree root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "managed-workspace-create-"));
    const projectA = path.join(root, "project-a");
    const projectB = path.join(root, "project-b");
    const paseoHome = path.join(root, "paseo");
    await Promise.all([mkdir(projectA), mkdir(projectB), mkdir(paseoHome)]);
    execFileSync("git", ["init", "-b", "main"], { cwd: projectA, stdio: "pipe" });
    const link = path.join(projectA, "foreign-link");
    await symlink(projectB, link, process.platform === "win32" ? "junction" : "dir");
    const authorizer = createHarness(["project.use", "workspace.create"], {
      projectA,
      projectB,
    });
    try {
      await expect(
        authorizer.allowsInbound({
          type: "workspace.create.request",
          requestId: "symlink",
          source: { kind: "directory", projectId: "project-a", path: link },
        }),
      ).resolves.toBe(false);
      await expect(authorizer.allowsWorktreeDestination(projectA, paseoHome)).resolves.toBe(true);
      const destination = await getPaseoWorktreesRoot(projectA, paseoHome);
      await mkdir(path.dirname(destination), { recursive: true });
      await symlink(projectB, destination, process.platform === "win32" ? "junction" : "dir");
      await expect(authorizer.allowsWorktreeDestination(projectA, paseoHome)).resolves.toBe(false);
    } finally {
      authorizer.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("managed resource denial explanations", () => {
  it("explains terminal permission denial inside a visible project", async () => {
    const authorizer = createHarness(["project.use", "agent.interact"]);
    const message = {
      type: "create_terminal_request" as const,
      requestId: "denied",
      workspaceId: "workspace-a",
      cwd: "/work/a",
    };
    await expect(authorizer.allowsInbound(message)).resolves.toBe(false);
    await expect(authorizer.denialCode(message)).resolves.toBe("access_denied");
    await expect(
      authorizer.denialCode({
        type: "capture_terminal_request",
        requestId: "capture",
        terminalId: "terminal-a",
      }),
    ).resolves.toBe("access_denied");
  });
  it.each(["workspace-b", "missing-workspace"])(
    "does not disclose foreign or missing target %s",
    async (workspaceId) => {
      const authorizer = createHarness(["project.use"]);
      await expect(
        authorizer.denialCode({
          type: "create_terminal_request",
          requestId: "denied",
          workspaceId,
          cwd: "/work/a",
        }),
      ).resolves.toBe("resource_not_found");
    },
  );
  it("keeps unknown and foreign terminal IDs indistinguishable", async () => {
    const authorizer = createHarness(["project.use"]);
    for (const terminalId of ["terminal-b", "missing-terminal"]) {
      await expect(
        authorizer.denialCode({
          type: "capture_terminal_request",
          requestId: "capture",
          terminalId,
        }),
      ).resolves.toBe("resource_not_found");
    }
  });
});

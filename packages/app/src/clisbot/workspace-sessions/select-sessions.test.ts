import { describe, expect, it } from "vitest";
import type { MessageSubmissionRecord } from "@/composer/submission/model";
import type { Agent } from "@/stores/session-store";
import { toggleExpandedWorkspaceKey } from "./expansion-store";
import { DEFAULT_SIDEBAR_WORKSPACE_SESSIONS, SidebarWorkspaceSessionsSchema } from "./preferences";
import { hasWorkspaceSessionLine, selectWorkspaceSessions } from "./select-sessions";
import {
  buildStatusSessionShortcutModel,
  sessionDisplayGroups,
  type StatusDisplayGroup,
  type StatusGroupItem,
} from "./status-sessions";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { clisbotWorkspaceGroups, quickGroupModes, resolveSidebarGroupMode } from "./grouping";
import { statusWorkspaceGroups } from "@/components/sidebar/sidebar-labels";
import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";

const WORKSPACE_ID = "ws-1";

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  const createdAt = input.createdAt ?? new Date("2026-09-01T00:00:00.000Z");
  return {
    serverId: "srv",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt,
    updatedAt: createdAt,
    lastUserMessageAt: null,
    lastActivityAt: createdAt,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: { provider: "codex", sessionId: null },
    title: null,
    cwd: "/repo",
    workspaceId: WORKSPACE_ID,
    model: null,
    thinkingOptionId: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    ...input,
  };
}

function sourceOf(
  agents: Agent[],
  messageSubmissions = new Map<string, MessageSubmissionRecord[]>(),
) {
  return { agents: new Map(agents.map((agent) => [agent.id, agent])), messageSubmissions };
}

function summarize(sessions: ReturnType<typeof selectWorkspaceSessions>) {
  return sessions.map((session) => [session.agent.id, session.title, session.statusBucket]);
}

describe("selectWorkspaceSessions", () => {
  it("keeps a done session a pane is showing when only active sessions are listed", () => {
    const source = sourceOf([makeAgent({ id: "open" }), makeAgent({ id: "elsewhere" })]);
    const listed = (keepAgentIds?: ReadonlySet<string>) =>
      selectWorkspaceSessions({
        source,
        workspaceId: WORKSPACE_ID,
        activeOnly: true,
        keepAgentIds,
      }).map((session) => session.agent.id);
    expect(listed()).toEqual([]);
    expect(listed(new Set(["open"]))).toEqual(["open"]);
  });

  it("lists the workspace's unarchived root sessions in creation order", () => {
    const source = sourceOf([
      makeAgent({ id: "second", title: "Fix login", createdAt: new Date("2026-09-02") }),
      makeAgent({ id: "first", title: "  New agent  ", createdAt: new Date("2026-09-01") }),
      makeAgent({ id: "child", parentAgentId: "first" }),
      makeAgent({ id: "archived", archivedAt: new Date("2026-09-03") }),
      makeAgent({ id: "elsewhere", workspaceId: "ws-2" }),
    ]);

    const sessions = selectWorkspaceSessions({
      source,
      workspaceId: WORKSPACE_ID,
      activeOnly: false,
    });

    expect(summarize(sessions)).toEqual([
      ["first", null, "done"],
      ["second", "Fix login", "done"],
    ]);
  });

  it("keeps only sessions with a live status mark when activeOnly is on", () => {
    const source = sourceOf(
      [
        makeAgent({ id: "idle" }),
        makeAgent({
          id: "open-turn",
          turn: { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null },
        }),
        makeAgent({ id: "unread", requiresAttention: true, attentionReason: "finished" }),
        makeAgent({ id: "just-sent" }),
      ],
      new Map([
        [
          "just-sent",
          [{ providerAcknowledged: false, rpcSettled: false } as MessageSubmissionRecord],
        ],
      ]),
    );

    const sessions = selectWorkspaceSessions({
      source,
      workspaceId: WORKSPACE_ID,
      activeOnly: true,
    });

    // A message the provider has not acknowledged yet reads as running, exactly as on the tab.
    expect(summarize(sessions)).toEqual([
      ["open-turn", null, "running"],
      ["unread", null, "attention"],
      ["just-sent", null, "running"],
    ]);
  });
});

describe("SidebarWorkspaceSessionsSchema", () => {
  it("defaults to visible when absent or malformed", () => {
    expect(SidebarWorkspaceSessionsSchema.parse(undefined)).toEqual(
      DEFAULT_SIDEBAR_WORKSPACE_SESSIONS,
    );
    expect(SidebarWorkspaceSessionsSchema.parse("nope")).toEqual(
      DEFAULT_SIDEBAR_WORKSPACE_SESSIONS,
    );
  });

  it("repairs bad fields one at a time and fills details added later", () => {
    expect(
      SidebarWorkspaceSessionsSchema.parse({
        visible: true,
        expansion: "sideways",
        activeOnly: 1,
        fullTitles: "yes",
        details: { model: true },
      }),
    ).toEqual({
      visible: true,
      expansion: "autoCollapse",
      activeOnly: false,
      fullTitles: true,
      details: { ...DEFAULT_SIDEBAR_WORKSPACE_SESSIONS.details, model: true },
    });
  });

  it.each(["autoCollapse", "manual", "alwaysExpanded"])(
    "preserves the %s expansion setting when sessions are hidden",
    (expansion) => {
      expect(
        SidebarWorkspaceSessionsSchema.parse({
          ...DEFAULT_SIDEBAR_WORKSPACE_SESSIONS,
          visible: false,
          expansion,
        }),
      ).toEqual({
        ...DEFAULT_SIDEBAR_WORKSPACE_SESSIONS,
        visible: false,
        expansion,
      });
    },
  );
});

describe("toggleExpandedWorkspaceKey", () => {
  it("stores only open workspaces", () => {
    const opened = toggleExpandedWorkspaceKey({}, "srv:ws-1");
    expect(opened).toEqual({ "srv:ws-1": true });
    expect(toggleExpandedWorkspaceKey(opened, "srv:ws-1")).toEqual({});
  });
});

describe("hasWorkspaceSessionLine", () => {
  // The row's fill and the list's selected line must agree, so this matches the listing rule.
  it("agrees with selectWorkspaceSessions for every agent", () => {
    const source = sourceOf([
      makeAgent({ id: "idle" }),
      makeAgent({ id: "unread", requiresAttention: true, attentionReason: "finished" }),
      makeAgent({ id: "child", parentAgentId: "idle" }),
      makeAgent({ id: "archived", archivedAt: new Date("2026-09-03") }),
      makeAgent({ id: "elsewhere", workspaceId: "ws-2" }),
    ]);
    for (const activeOnly of [false, true]) {
      const listed = new Set(
        selectWorkspaceSessions({ source, workspaceId: WORKSPACE_ID, activeOnly }).map(
          (session) => session.agent.id,
        ),
      );
      for (const agentId of ["idle", "unread", "child", "archived", "elsewhere", "missing"]) {
        expect(
          hasWorkspaceSessionLine({ source, workspaceId: WORKSPACE_ID, agentId, activeOnly }),
        ).toBe(listed.has(agentId));
      }
    }
  });
});

function makeWorkspace(
  workspaceId: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"],
  project = "project",
): SidebarWorkspaceEntry {
  return {
    workspaceKey: `srv:${workspaceId}`,
    serverId: "srv",
    workspaceId,
    projectViewKey: project,
    projectName: project,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

function describeGroups(groups: StatusDisplayGroup[]) {
  return groups.map((group) => [group.key, group.items.map(describeItem)]);
}

function describeItem(item: StatusGroupItem): string {
  return item.kind === "session"
    ? item.session.agent.id
    : `workspace:${item.workspace.workspaceId}`;
}

describe("sessionDisplayGroups by status", () => {
  const workspaces = [
    makeWorkspace(WORKSPACE_ID, "running"),
    makeWorkspace("ws-2", "done"),
    makeWorkspace("terminal-only", "done"),
  ];
  const groups = statusWorkspaceGroups(buildStatusGroups(workspaces, new Map()));
  const source = sourceOf([
    makeAgent({ id: "older-idle", createdAt: new Date("2026-09-01") }),
    makeAgent({
      id: "working",
      turn: { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null },
    }),
    makeAgent({
      id: "messaged-idle",
      createdAt: new Date("2026-09-01"),
      lastUserMessageAt: new Date("2026-09-05"),
    }),
    makeAgent({ id: "other-workspace", workspaceId: "ws-2", createdAt: new Date("2026-09-03") }),
    makeAgent({ id: "child", parentAgentId: "working" }),
  ]);

  function summarizeGroups(activeOnly: boolean) {
    return describeGroups(
      sessionDisplayGroups({
        groups,
        sources: new Map([["srv", source]]),
        activeOnly,
        byStatus: true,
      }),
    );
  }

  it("files each session under its own status, most recently messaged first", () => {
    expect(summarizeGroups(false)).toEqual([
      ["running", ["working"]],
      ["done", ["messaged-idle", "other-workspace", "older-idle", "workspace:terminal-only"]],
    ]);
  });

  it("keeps a workspace without sessions as a row, and hides done sessions when activeOnly", () => {
    expect(summarizeGroups(true)).toEqual([
      ["running", ["working"]],
      ["done", ["workspace:terminal-only"]],
    ]);
  });

  it("keeps a workspace row while its host's sessions are not loaded", () => {
    const loading = sessionDisplayGroups({
      groups,
      sources: new Map(),
      activeOnly: false,
      byStatus: true,
    });
    expect(describeGroups(loading)).toEqual([
      ["running", ["workspace:ws-1"]],
      ["done", ["workspace:terminal-only", "workspace:ws-2"]],
    ]);
  });

  it("numbers pinned rows first, then each open header's lines, and a session opens itself", () => {
    const displayGroups = sessionDisplayGroups({
      groups,
      sources: new Map([["srv", source]]),
      activeOnly: false,
      byStatus: true,
    });
    const pinned = makeWorkspace("pinned", "done");
    const model = buildStatusSessionShortcutModel({
      pinnedWorkspaces: [pinned],
      pinnedCollapsed: false,
      groups: displayGroups,
      collapsedGroupKeys: new Set(["running"]),
    });
    expect(model.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: WORKSPACE_ID, agentId: "messaged-idle" },
      { serverId: "srv", workspaceId: "ws-2", agentId: "other-workspace" },
      { serverId: "srv", workspaceId: WORKSPACE_ID, agentId: "older-idle" },
      { serverId: "srv", workspaceId: "terminal-only" },
    ]);
    expect(model.shortcutIndexByWorkspaceKey.get(`srv:${WORKSPACE_ID}:older-idle`)).toBe(4);
    expect(model.shortcutIndexByWorkspaceKey.has(`srv:${WORKSPACE_ID}:working`)).toBe(false);
  });
});

describe("Clisbot groupings", () => {
  const app = makeWorkspace(WORKSPACE_ID, "running", "app");
  const appEmpty = makeWorkspace("terminal-only", "done", "app");
  const docs = makeWorkspace("ws-2", "done", "docs");
  const entries = new Map([app, appEmpty, docs].map((entry) => [entry.workspaceKey, entry]));
  const projects = [
    projectOf("app", [app, appEmpty]),
    projectOf("docs", [docs]),
    projectOf("empty", []),
  ];
  const source = sourceOf([
    makeAgent({ id: "older", createdAt: new Date("2026-09-01") }),
    makeAgent({ id: "messaged", lastUserMessageAt: new Date("2026-09-05") }),
    makeAgent({ id: "docs-session", workspaceId: "ws-2", createdAt: new Date("2026-09-03") }),
  ]);
  const sources = new Map([["srv", source]]);

  it("Workspace lists every row in project order with no header", () => {
    const groups = clisbotWorkspaceGroups({
      mode: "workspace",
      projects,
      workspaceEntriesByKey: entries,
    });
    const group = groups[0];
    expect(groups).toHaveLength(1);
    expect(group?.leading.kind).toBe("none");
    expect(group?.rows.map((row) => row.workspaceId)).toEqual([
      WORKSPACE_ID,
      "terminal-only",
      "ws-2",
    ]);
  });

  it("Project › Session lists sessions under each project header and drops an empty project", () => {
    const groups = clisbotWorkspaceGroups({
      mode: "projectSession",
      projects,
      workspaceEntriesByKey: entries,
    });
    const display = sessionDisplayGroups({ groups, sources, activeOnly: false, byStatus: false });
    expect(describeGroups(display)).toEqual([
      ["project:app", ["messaged", "older", "workspace:terminal-only"]],
      ["project:docs", ["docs-session"]],
    ]);
  });

  it("Session lists every session flat, most recently messaged first", () => {
    const groups = clisbotWorkspaceGroups({
      mode: "session",
      projects,
      workspaceEntriesByKey: entries,
    });
    const display = sessionDisplayGroups({ groups, sources, activeOnly: false, byStatus: false });
    expect(describeGroups(display)).toEqual([
      ["all", ["messaged", "docs-session", "older", "workspace:terminal-only"]],
    ]);
  });

  it("offers the two most picked groupings as tabs, in a fixed order", () => {
    expect(quickGroupModes({})).toEqual(["project", "session"]);
    expect(quickGroupModes({ status: 3, session: 1 })).toEqual(["session", "status"]);
    expect(quickGroupModes({ status: 3, workspace: 3, project: 1 })).toEqual([
      "workspace",
      "status",
    ]);
  });

  it("draws each session mode without sessions as its workspace twin", () => {
    expect(resolveSidebarGroupMode("projectSession", false)).toBe("project");
    expect(resolveSidebarGroupMode("session", false)).toBe("workspace");
    expect(resolveSidebarGroupMode("status", false)).toBe("statusWorkspace");
    expect(resolveSidebarGroupMode("statusWorkspace", true)).toBe("statusWorkspace");
    expect(resolveSidebarGroupMode("session", true)).toBe("session");
  });
});

function projectOf(viewKey: string, workspaces: SidebarWorkspaceEntry[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [],
    workspaces,
  };
}

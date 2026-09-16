import { describe, expect, it } from "vitest";
import type { MessageSubmissionRecord } from "@/composer/submission/model";
import type { Agent } from "@/stores/session-store";
import { toggleExpandedWorkspaceKey } from "./expansion-store";
import { DEFAULT_SIDEBAR_WORKSPACE_SESSIONS, SidebarWorkspaceSessionsSchema } from "./preferences";
import { hasWorkspaceSessionLine, selectWorkspaceSessions } from "./select-sessions";

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
  it("defaults to off when absent or malformed", () => {
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

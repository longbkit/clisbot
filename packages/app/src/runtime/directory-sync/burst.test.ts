import { afterEach, describe, expect, it } from "vitest";
import type { DaemonClient, FetchAgentsEntry } from "@clisbot/client/internal/daemon-client";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "@clisbot/protocol/messages";
import { indexWorkSessions } from "@/clisbot/navigation/work-filter";
import {
  listWorkspaceRootAgents,
  type WorkspaceSessionSource,
} from "@/clisbot/workspace-sessions/select-sessions";
import { useSessionStore } from "@/stores/session-store";
import { subscriptionFixture } from "../subscription-fixture";
import { createManualFrameClock } from "./frame-clock-fixture";
import { shareFrames } from "./live-batch";
import { DirectorySync } from "./index";

type WorkspaceEntry = Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>["entries"][number];

const HOSTS = 14;
const AGENTS_PER_HOST = 400;
const WORKSPACES_PER_HOST = 20;
const UPDATES = 300;
const UPDATES_PER_FRAME = 20;

function agentPayload(input: {
  id: string;
  workspaceId: string;
  title: string;
  updatedAt: string;
  status?: AgentSnapshotPayload["status"];
}): AgentSnapshotPayload {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    provider: "codex",
    cwd: "/repo",
    model: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: input.updatedAt,
    lastUserMessageAt: null,
    status: input.status ?? "idle",
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
    title: input.title,
    labels: {},
  };
}

function agentEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: "/repo",
      projectName: "repo",
      checkout: {
        cwd: "/repo",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isClisbotOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function workspaceEntry(id: string, status: WorkspaceEntry["status"]): WorkspaceEntry {
  return {
    id,
    projectId: "project",
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: id,
    status,
    statusEnteredAt: null,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

const workspaceIdOf = (host: number, agent: number) => `h${host}-ws${agent % WORKSPACES_PER_HOST}`;

class FakeHost {
  private readonly listeners = new Map<string, Set<(message: SessionOutboundMessage) => void>>();

  constructor(private readonly host: number) {}

  supportsBackgroundWorkspaces = () => false;
  getLastServerInfoMessage = () => null;

  emit(message: SessionOutboundMessage): void {
    for (const listener of this.listeners.get(message.type) ?? []) listener(message);
  }

  private on(type: string, listener: (message: SessionOutboundMessage) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return () => set.delete(listener);
  }

  async fetchAgents() {
    const entries = Array.from({ length: AGENTS_PER_HOST }, (_, agent) =>
      agentEntry(
        agentPayload({
          id: `h${this.host}-a${agent}`,
          workspaceId: workspaceIdOf(this.host, agent),
          title: "initial",
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
      ),
    );
    return {
      requestId: "agents",
      entries,
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async fetchWorkspaces() {
    return {
      requestId: "workspaces",
      entries: Array.from({ length: WORKSPACES_PER_HOST }, (_, index) =>
        workspaceEntry(`h${this.host}-ws${index}`, "done"),
      ),
      emptyProjects: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async listProjects() {
    return { requestId: "projects", projects: [] };
  }

  async listWorkspaceScripts(workspaceId: string) {
    return { requestId: "scripts", workspaceId, scripts: [], error: null };
  }

  observeAgents() {
    return subscriptionFixture(this.fetchAgents(), (receive) => this.on("agent_update", receive));
  }

  observeWorkspaces() {
    return subscriptionFixture(this.fetchWorkspaces(), (receive) =>
      this.on("workspace_update", receive),
    );
  }

  observeEvents(events: readonly SessionOutboundMessage["type"][]) {
    return subscriptionFixture(Promise.resolve({ events }), (receive) => {
      const stops = events.map((event) => this.on(event, receive));
      return () => stops.forEach((stop) => stop());
    });
  }
}

/**
 * The 300 interleaved messages: two agent updates for each workspace update. Agent updates
 * alternate a real change, an exact repeat and a timestamp-only bump; every tenth workspace
 * update removes a workspace, and three agents are tombstoned along the way.
 */
function burstMessage(index: number): { host: number; message: SessionOutboundMessage } {
  const host = index % HOSTS;
  const round = Math.floor(index / HOSTS);
  if (index % 3 === 2) {
    const workspaceId = `h${host}-ws${round % WORKSPACES_PER_HOST}`;
    const payload =
      round % 10 === 9
        ? { kind: "remove" as const, id: workspaceId }
        : { kind: "upsert" as const, workspace: workspaceEntry(workspaceId, "running") };
    return { host, message: { type: "workspace_update", payload } };
  }
  const agent = (round * 7) % AGENTS_PER_HOST;
  const id = `h${host}-a${agent}`;
  if (index === 100 || index === 200 || index === 250) {
    return { host, message: { type: "agent_update", payload: { kind: "remove", agentId: id } } };
  }
  const variant = index % 3;
  const updatedAt = variant === 1 ? "2026-10-02T00:00:00.000Z" : "2026-10-01T00:00:00.000Z";
  const title = variant === 0 && round % 2 === 0 ? `live ${index}` : "initial";
  const status: AgentSnapshotPayload["status"] = round % 4 === 0 ? "running" : "idle";
  return {
    host,
    message: {
      type: "agent_update",
      payload: {
        kind: "upsert",
        ...agentEntry(
          agentPayload({ id, workspaceId: workspaceIdOf(host, agent), title, updatedAt, status }),
        ),
      },
    },
  };
}

interface BurstCounts {
  storeNotifications: number;
  sidebarIndexRecomputations: number;
  sidebarModelChanges: number;
  sessionRowRecomputations: number;
}

/**
 * What the Work tree recomputes per store notification, by the identities its memos key on:
 * `useWorkSessionsOf` re-runs when a Host's agents map changes and hands the sidebar model a new
 * index when that index's identity changes; a session row re-runs when its list's identity does.
 */
function createWorkTreeProbe(hostIds: readonly string[]) {
  const counts: BurstCounts = {
    storeNotifications: 0,
    sidebarIndexRecomputations: 0,
    sidebarModelChanges: 0,
    sessionRowRecomputations: 0,
  };
  const rows = hostIds.flatMap((serverId, host) =>
    Array.from({ length: WORKSPACES_PER_HOST }, (_, ws) => ({
      serverId,
      workspaceId: `h${host}-ws${ws}`,
    })),
  );
  const readAgents = () =>
    hostIds.map((serverId) => useSessionStore.getState().sessions[serverId]?.agents);
  let agentMaps = readAgents();
  let index = indexWorkSessions(sources(hostIds));
  const rowAgents = rows.map((row) =>
    listWorkspaceRootAgents(agentMaps[hostIds.indexOf(row.serverId)], row.workspaceId),
  );
  const unsubscribe = useSessionStore.subscribe(() => {
    counts.storeNotifications += 1;
    const nextMaps = readAgents();
    if (nextMaps.every((map, i) => map === agentMaps[i])) return;
    counts.sidebarIndexRecomputations += 1;
    const nextIndex = indexWorkSessions(sources(hostIds), index);
    if (nextIndex !== index) counts.sidebarModelChanges += 1;
    index = nextIndex;
    rows.forEach((row, i) => {
      const host = hostIds.indexOf(row.serverId);
      if (nextMaps[host] === agentMaps[host]) return;
      const next = listWorkspaceRootAgents(nextMaps[host], row.workspaceId);
      if (next !== rowAgents[i]) counts.sessionRowRecomputations += 1;
      rowAgents[i] = next;
    });
    agentMaps = nextMaps;
  });
  return { counts, stop: unsubscribe };
}

function sources(hostIds: readonly string[]): Map<string, WorkspaceSessionSource> {
  const map = new Map<string, WorkspaceSessionSource>();
  for (const serverId of hostIds) {
    const session = useSessionStore.getState().sessions[serverId];
    if (session) map.set(serverId, session);
  }
  return map;
}

const serverIds = Array.from({ length: HOSTS }, (_, host) => `burst-host-${host}`);

afterEach(() => {
  for (const serverId of serverIds) useSessionStore.getState().clearSession(serverId);
});

describe("a burst of live directory updates across many Hosts", () => {
  it("lands as one store commit per frame and leaves untouched rows alone", async () => {
    const clock = createManualFrameClock();
    // One frame for every Host, as the app's HostRuntimeStore builds it.
    const frames = shareFrames(clock);
    const hosts = serverIds.map((serverId, host) => {
      const client = new FakeHost(host);
      const store = useSessionStore.getState();
      store.initializeSession(serverId, client as unknown as DaemonClient, 1);
      store.updateSessionServerInfo(serverId, {
        serverId,
        hostname: null,
        version: "test",
        features: { workspaceMultiplicity: true },
      });
      const directory = new DirectorySync(
        serverId,
        {
          onAgentStoppedRunning: () => undefined,
          markAgentLoading: () => undefined,
          markAgentReady: () => undefined,
          markAgentError: () => undefined,
          markWorkspaceLoading: () => undefined,
          markWorkspaceReady: () => undefined,
          markWorkspaceError: () => undefined,
        },
        undefined,
        { frameClock: frames },
      );
      directory.connectionChanged({
        client: client as unknown as DaemonClient,
        status: "online",
        source: { clientGeneration: 1, connectionEpoch: 1 },
      });
      return { client, directory };
    });
    await Promise.all(hosts.map(({ directory }) => directory.refreshAll()));

    const probe = createWorkTreeProbe(serverIds);
    for (let index = 0; index < UPDATES; index += 1) {
      const { host, message } = burstMessage(index);
      hosts[host]!.client.emit(message);
      if ((index + 1) % UPDATES_PER_FRAME === 0) clock.tick();
    }
    clock.tick();
    probe.stop();

    const session = (host: number) => useSessionStore.getState().sessions[serverIds[host]!]!;
    expect(session(2).agents.has("h2-a49")).toBe(false);
    expect(session(0).agents.get("h0-a0")?.title).toBe("live 0");
    expect(session(2).workspaces.has("h2-ws9")).toBe(false);
    // Before frame batching and the root-agent index (2026-10-30) the same burst cost 498 store
    // notifications, 200 index recomputations, 200 sidebar model changes and 4,000 row recomputations;
    // with a frame per Host instead of one shared frame, 191, 138, 57 and 151.
    expect(probe.counts).toEqual({
      storeNotifications: 15,
      sidebarIndexRecomputations: 15,
      sidebarModelChanges: 10,
      sessionRowRecomputations: 151,
    });
    for (const { directory } of hosts) directory.dispose();
  });

  it("lands an agent's activity bump in the same store commit as its update", async () => {
    const clock = createManualFrameClock();
    const serverId = serverIds[0]!;
    const client = new FakeHost(0);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });
    const directory = new DirectorySync(
      serverId,
      {
        onAgentStoppedRunning: () => undefined,
        markAgentLoading: () => undefined,
        markAgentReady: () => undefined,
        markAgentError: () => undefined,
        markWorkspaceLoading: () => undefined,
        markWorkspaceReady: () => undefined,
        markWorkspaceError: () => undefined,
      },
      undefined,
      { frameClock: shareFrames(clock) },
    );
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    await directory.refreshAll();
    useSessionStore.getState().flushAgentLastActivity();
    let notifications = 0;
    const unsubscribe = useSessionStore.subscribe(() => {
      notifications += 1;
    });

    const updatedAt = "2026-10-03T00:00:00.000Z";
    const agent = agentPayload({
      id: "h0-a1",
      workspaceId: workspaceIdOf(0, 1),
      title: "initial",
      updatedAt,
    });
    client.emit({ type: "agent_update", payload: { kind: "upsert", ...agentEntry(agent) } });
    clock.tick();
    // Past the activity flush's own frame, which used to commit a second time.
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsubscribe();

    expect(notifications).toBe(1);
    expect(useSessionStore.getState().agentLastActivity.get("h0-a1")?.toISOString()).toBe(
      updatedAt,
    );
    directory.dispose();
  });
});

import { createWorkspaceRuntimeStore } from "./workspace-runtime-store/index.js";
import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { PushNotificationSender, PushNotificationTarget, PushPayload } from "./push/index.js";
import type { NotificationReader } from "@clisbot/protocol/notification-audience";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { createPushNotifications } from "./push/index.js";
import { forgetTerminalLaunch, recordTerminalLaunch } from "./managed-access/terminal-launches.js";
import { NotificationFollowStore } from "./push/follow-store.js";
import { notificationReaderKey } from "@clisbot/protocol/notification-audience";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

const WORKSPACE_ID = "workspace-1";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    once(event: string, handler: (...args: unknown[]) => void) {
      return this.on(event, handler);
    }

    close() {
      this.handlers.get("close")?.();
    }
  }

  return { MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: function Session() {
    return {};
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

interface WebSocketServerInternals {
  sessions: Map<unknown, unknown>;
  broadcastAgentAttention(params: {
    agentId: string;
    reason: string;
    preview?: string;
    providerId?: string;
    timestamp?: string;
  }): Promise<void>;
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createWorkspaceAutoNameStub(): WorkspaceAutoName {
  return createStub<WorkspaceAutoName>({
    scheduleForWorktree: () => {},
    scheduleForDirectory: () => {},
  });
}

/** The Host owner's own paired phone: no Hub identity, every Project. */
const HOST_OWNER_READER: NotificationReader = { actor: null, daemonWide: true, scope: "mine" };

/** Records what reaches the Host owner's phone, the token these tests have always modelled. */
class RecordingPushNotificationSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];

  async send(payload: PushPayload, target?: PushNotificationTarget): Promise<void> {
    if (target?.recipients && !target.recipients(HOST_OWNER_READER)) return;
    this.sent.push(payload);
  }
}

function createServer(
  agentManagerOverrides?: Record<string, unknown>,
  pushNotifications: PushNotificationSender = new RecordingPushNotificationSender(),
) {
  const agentManager = {
    subscribe: vi.fn(() => () => {}),
    setAgentAttentionCallback: vi.fn(),
    getAgent: vi.fn((): unknown => ({ workspaceId: WORKSPACE_ID, pendingPermissions: new Map() })),
    getLastAssistantMessage: vi.fn(async () => null),
    getMetricsSnapshot: vi.fn(() => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: {
        totalItems: 0,
        maxItemsPerAgent: 0,
      },
    })),
    ...agentManagerOverrides,
  };
  const daemonConfigStore = {
    onApply: vi.fn(() => () => {}),
    onChange: vi.fn(() => () => {}),
    onFieldChange: vi.fn(() => () => {}),
  };

  const server = new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({ on: vi.fn(), off: vi.fn() }),
    createStub<pino.Logger>(createLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({ get: vi.fn(async () => null) }),
    createStub<DownloadTokenStore>({}),
    "/tmp/clisbot-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    createWorkspaceAutoNameStub(),
    createWorkspaceRuntimeStore(),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pushNotifications,
    createProviderSnapshotManagerStub().manager,
  );

  return {
    server,
    agentManager,
    pushNotifications: pushNotifications as RecordingPushNotificationSender,
  };
}

function createOpenSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function createSessionWithActivity(
  activity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt?: Date;
  } | null,
  subscribed = true,
) {
  return {
    getClientActivity: vi.fn(() => activity),
    supports: () => false,
    supportsForSource: () => false,
    subscribesToAgent: vi.fn(async () => subscribed),
  };
}

function connectClient(
  server: VoiceAssistantWebSocketServer,
  activity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt?: Date;
  } | null,
  options: {
    subscribed?: boolean;
    reader?: NotificationReader | null;
    allowsResource?: boolean;
    published?: unknown[];
  } = {},
) {
  const ws = createOpenSocket();
  const delivery = new SessionDelivery(() => {});
  delivery.attach(ws, options.published !== undefined);
  asInternals<WebSocketServerInternals>(server).sessions.set(ws, {
    kind: "trusted",
    session: {
      ...createSessionWithActivity(activity, options.subscribed ?? true),
      delivery,
      wantsSourceNotification: () => true,
      notificationReader: () => (options.reader === undefined ? HOST_OWNER_READER : options.reader),
      allowsNotificationAbout: () => options.allowsResource ?? true,
      wantsSourceEvent: () => true,
      publishToSource: (_source: unknown, message: unknown) => options.published?.push(message),
    },
    clientId: "client-test",
    appVersion: null,
    connectionLogger: createLogger(),
    sockets: new Set([ws]),
    externalDisconnectCleanupTimeout: null,
  });
  return ws;
}

function readAttentionRequiredMessage(ws: ReturnType<typeof createOpenSocket>) {
  const rawMessage = ws.send.mock.calls[0]?.[0];
  expect(typeof rawMessage).toBe("string");
  if (typeof rawMessage !== "string") throw new Error("Expected string WebSocket frame");
  const message = JSON.parse(rawMessage);
  expect(message.type).toBe("session");
  expect(message.message.type).toBe("agent_stream");
  expect(message.message.payload.event.type).toBe("attention_required");
  return message.message.payload.event;
}

describe("VoiceAssistantWebSocketServer notification payloads", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not emit attention or include presence without an agent-directory subscription", async () => {
    const { server, pushNotifications } = createServer();
    const now = new Date();
    const unsubscribed = connectClient(
      server,
      {
        deviceType: "web",
        appVisible: true,
        focusedAgentId: "agent-1",
        lastActivityAt: now,
      },
      { subscribed: false },
    );

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-1",
      provider: "claude",
      reason: "finished",
    });

    expect(unsubscribed.send).not.toHaveBeenCalled();
    expect(pushNotifications.sent).toHaveLength(1);
  });

  it("uses assistant preview text for push notifications with markdown removed", async () => {
    const getLastAssistantMessage = vi.fn(
      async () => "**Done**. Updated `README.md` and [link](https://example.com).",
    );
    const { server, pushNotifications } = createServer({
      getAgent: vi.fn(() => ({
        config: { title: null },
        cwd: "/tmp/worktree",
        workspaceId: WORKSPACE_ID,
        pendingPermissions: new Map(),
      })),
      getLastAssistantMessage,
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-1",
      provider: "claude",
      reason: "finished",
    });

    expect(pushNotifications.sent).toEqual([
      {
        title: "Agent finished",
        body: "Done. Updated README.md and link.",
        data: {
          serverId: "srv-test",
          workspaceId: WORKSPACE_ID,
          agentId: "agent-1",
          reason: "finished",
        },
      },
    ]);
    expect(getLastAssistantMessage).toHaveBeenCalledWith("agent-1");
  });

  it("sends push notifications regardless of UI label presence", async () => {
    const getLastAssistantMessage = vi.fn(async () => "Done.");
    const { server, pushNotifications } = createServer({
      getAgent: vi.fn(() => ({
        config: { title: null },
        cwd: "/tmp/worktree",
        workspaceId: WORKSPACE_ID,
        labels: {},
        pendingPermissions: new Map(),
      })),
      getLastAssistantMessage,
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-2",
      provider: "claude",
      reason: "finished",
    });

    expect(pushNotifications.sent).toHaveLength(1);
    expect(getLastAssistantMessage).toHaveBeenCalledWith("agent-2");
  });

  it("routes a hidden stale focused browser tab's notification to the present Electron web client", async () => {
    const { server, pushNotifications } = createServer();
    const nowMs = Date.now();
    const electronWs = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: "agent-Y",
      lastActivityAt: new Date(nowMs - 5_000),
    });
    const firefoxWs = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: "agent-X",
      lastActivityAt: new Date(nowMs - 300_000),
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "finished",
    });

    expect(readAttentionRequiredMessage(electronWs).shouldNotify).toBe(true);
    expect(readAttentionRequiredMessage(firefoxWs).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toEqual([]);
  });

  it("pushes non-error attention when the only connected client has never sent a heartbeat", async () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server, null);

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-no-heartbeat",
      provider: "claude",
      reason: "finished",
    });

    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toHaveLength(1);
  });

  it("does not push error attention when the only connected client has never sent a heartbeat", async () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server, null);

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-no-heartbeat",
      provider: "claude",
      reason: "error",
    });

    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toEqual([]);
  });
});

const HUB = "https://hub.example";
const PROJECT_ID = "project-a";

function member(memberId: string): SessionActor {
  return {
    kind: "user",
    id: `user-${memberId}`,
    memberId,
    organizationId: "org-1",
    hubOrigin: HUB,
    hubIdentity: "hub-1",
  };
}

const ALICE = member("alice");
const BOB = member("bob");

function memberReader(
  actor: SessionActor,
  scope: NotificationReader["scope"] = "mine",
): NotificationReader {
  return { actor, daemonWide: false, scope };
}

/** A real token store on a scratch file; delivery is captured, nothing leaves the process. */
function createTokenAudience() {
  const delivered: Array<{ tokens: string[]; payload: PushPayload }> = [];
  const dir = mkdtempSync(join(tmpdir(), "clisbot-push-audience-"));
  const push = createPushNotifications({
    logger: createStub<pino.Logger>(createLogger()),
    filePath: join(dir, "push-tokens.json"),
    deliver: async (tokens, payload) => {
      delivered.push({ tokens: [...tokens].sort(), payload });
    },
  });
  const registerMember = (
    token: string,
    actor: SessionActor,
    options: { scope?: NotificationReader["scope"]; projectIds?: string[] | null } = {},
  ) =>
    push.renew(
      token,
      {
        leaseId: `lease-${token}`,
        leaseExpiresAt: Date.now() + 60 * 60 * 1000,
        projectIds: options.projectIds === undefined ? [PROJECT_ID] : options.projectIds,
      },
      { actor, scope: options.scope },
    );
  return { push, delivered, registerMember, dir, cleanup: () => rmSync(dir, { recursive: true }) };
}

/** The daemon's Hub link, through which lease revocations arrive. */
function setHubLink(server: VoiceAssistantWebSocketServer, state: "connected" | "reconnecting") {
  asInternals<{ hubRelationships: unknown }>(server).hubRelationships = {
    status: () => ({ state }),
  };
}

function createAudienceServer(
  agent: Record<string, unknown>,
  extraAgents = new Map(),
  hubLink: "connected" | "reconnecting" = "connected",
) {
  const audience = createTokenAudience();
  const { server } = createServer(
    {
      getAgent: vi.fn((agentId: string) =>
        agentId === "agent-1"
          ? { workspaceId: WORKSPACE_ID, pendingPermissions: new Map(), ...agent }
          : extraAgents.get(agentId),
      ),
    },
    audience.push,
  );
  asInternals<{ projectIdForWorkspace: () => Promise<string> }>(server).projectIdForWorkspace =
    async () => PROJECT_ID;
  asInternals<{ pushNotifications: unknown }>(server).pushNotifications = audience.push;
  const follows = new NotificationFollowStore(
    createStub<pino.Logger>(createLogger()),
    join(audience.dir, "notification-follows.json"),
  );
  asInternals<{ notificationFollows: unknown }>(server).notificationFollows = follows;
  setHubLink(server, hubLink);
  return { server, follows, ...audience };
}

async function finish(
  server: VoiceAssistantWebSocketServer,
  reason: "finished" | "permission" | "error" = "finished",
) {
  await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
    agentId: "agent-1",
    provider: "claude",
    reason,
  });
  await new Promise((resolve) => setImmediate(resolve));
}

describe("VoiceAssistantWebSocketServer notification audience", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function setup(
    agent: Record<string, unknown>,
    extraAgents?: Map<string, unknown>,
    hubLink?: "connected" | "reconnecting",
  ) {
    const result = createAudienceServer(agent, extraAgents, hubLink);
    cleanups.push(result.cleanup);
    return result;
  }

  it("pushes a teammate's finished session to its author only, not every Project Member", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("alice-phone", ALICE);
    registerMember("bob-phone", BOB);

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["bob-phone"]]);
  });

  it("a session someone else joined notifies the participant as For me", async () => {
    const { server, delivered, registerMember } = setup({
      createdBy: BOB,
      lastMessageBy: ALICE,
    });
    registerMember("alice-phone", ALICE);
    registerMember("bob-phone", BOB);

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["alice-phone", "bob-phone"]]);
  });

  it("a teammate's open app neither takes the author's notification nor suppresses their push", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("bob-phone", BOB);
    const aliceDesktop = connectClient(
      server,
      { deviceType: "web", appVisible: true, focusedAgentId: null, lastActivityAt: new Date() },
      { reader: memberReader(ALICE) },
    );

    await finish(server);

    expect(readAttentionRequiredMessage(aliceDesktop).shouldNotify).toBe(false);
    expect(delivered.map((entry) => entry.tokens)).toEqual([["bob-phone"]]);
  });

  it("the author's own present desktop takes the notification instead of their phone", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("bob-phone", BOB);
    const bobDesktop = connectClient(
      server,
      { deviceType: "web", appVisible: false, focusedAgentId: null, lastActivityAt: new Date() },
      { reader: memberReader(BOB) },
    );

    await finish(server);

    expect(readAttentionRequiredMessage(bobDesktop).shouldNotify).toBe(true);
    expect(delivered).toEqual([]);
  });

  it("the Host owner's present direct desktop never suppresses a daemon-wide admin's push", async () => {
    const { server, delivered, registerMember } = setup({});
    registerMember("admin-phone", BOB, { projectIds: null });
    registerMember("member-phone", ALICE, { scope: "all" });
    const ownerDesktop = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: null,
      lastActivityAt: new Date(),
    });

    await finish(server);

    expect(readAttentionRequiredMessage(ownerDesktop).shouldNotify).toBe(true);
    expect(delivered.map((entry) => entry.tokens)).toEqual([["admin-phone", "member-phone"]]);
  });

  it("honours each token's scope: All includes teammates, Others excludes own work, Off is silent", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("alice-all", ALICE, { scope: "all" });
    registerMember("alice-others", member("alice2"), { scope: "others" });
    registerMember("bob-others", BOB, { scope: "others" });
    registerMember("bob-off", member("bob2"), { scope: "off" });

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["alice-all", "alice-others"]]);
  });

  it("unattributed work pages the Host owner and daemon-wide readers, not Project Members", async () => {
    const { server, delivered, registerMember, push } = setup({});
    registerMember("member-phone", ALICE);
    registerMember("admin-phone", BOB, { projectIds: null });
    push.renew("owner-phone");

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["admin-phone", "owner-phone"]]);
  });

  it("a subagent belongs to whoever owns its parent", async () => {
    const parent = { createdBy: ALICE, labels: {} };
    const { server, delivered, registerMember } = setup(
      { labels: { "clisbot.parent-agent-id": "parent-1" } },
      new Map([["parent-1", parent]]),
    );
    registerMember("alice-phone", ALICE);
    registerMember("bob-phone", BOB);

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["alice-phone"]]);
  });

  it("a scheduled run belongs to the verified owner of its schedule", async () => {
    const { server, delivered, registerMember } = setup({
      createdBy: { kind: "automation", id: "schedule-1" },
      ownerActor: ALICE,
    });
    registerMember("alice-phone", ALICE);
    registerMember("bob-phone", BOB);

    await finish(server);

    expect(delivered.map((entry) => entry.tokens)).toEqual([["alice-phone"]]);
  });

  it("a channel sender matches a reader only through a verified Member link", async () => {
    const slack = (memberId?: string): SessionActor => ({
      kind: "user",
      id: "slack:U123",
      connectionId: "slack-connection",
      organizationId: "org-1",
      hubOrigin: HUB,
      ...(memberId ? { memberId } : {}),
    });
    const linked = setup({ createdBy: slack("alice") });
    linked.registerMember("alice-phone", ALICE);
    linked.registerMember("bob-phone", BOB);
    await finish(linked.server);

    const unlinked = setup({ createdBy: slack() });
    unlinked.registerMember("alice-phone", { ...ALICE, id: "slack:U123" });
    await finish(unlinked.server);

    expect(linked.delivered.map((entry) => entry.tokens)).toEqual([["alice-phone"]]);
    expect(unlinked.delivered).toEqual([]);
  });

  it("a Hub revocation for an offline device's lease removes its push token at once", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("bob-phone", BOB);

    expect(server.revokeManagedLeases(["lease-bob-phone"])).toBe(0);
    await finish(server);

    expect(delivered).toEqual([]);
  });

  it("without a live Hub link, lease devices get no session content; the Host owner keeps it", async () => {
    const { server, delivered, registerMember, push } = setup(
      { createdBy: BOB },
      undefined,
      "reconnecting",
    );
    registerMember("bob-phone", BOB);
    push.renew("owner-phone");
    const internals = asInternals<{ agentManager: { getLastAssistantMessage: unknown } }>(server);
    internals.agentManager.getLastAssistantMessage = async () => "Synthetic secret summary.";

    await finish(server);

    const bodies: Record<string, string> = {};
    for (const entry of delivered)
      for (const token of entry.tokens) bodies[token] = entry.payload.body;
    expect(bodies).toEqual({
      "owner-phone": "Synthetic secret summary.",
      "bob-phone": "Finished working.",
    });
  });

  it("Needs me pushes requests and failures in the reader's sessions, never finished turns", async () => {
    const { server, delivered, registerMember } = setup({ createdBy: BOB });
    registerMember("bob-needs", BOB, { scope: "needs" });
    registerMember("bob-mine", BOB, { scope: "mine" });
    registerMember("alice-needs", ALICE, { scope: "needs" });

    const tokensFor = async (reason: "finished" | "permission" | "error") => {
      delivered.length = 0;
      await finish(server, reason);
      return delivered.flatMap((entry) => entry.tokens).sort();
    };

    expect(await tokensFor("finished")).toEqual(["bob-mine"]);
    expect(await tokensFor("permission")).toEqual(["bob-mine", "bob-needs"]);
    // A failure stays in-app for For me, as before; Needs me asked for it on the phone.
    expect(await tokensFor("error")).toEqual(["bob-needs"]);
  });

  it("a followed teammate session counts as For me, but a follow never crosses Project access", async () => {
    const { server, delivered, registerMember, follows } = setup({ createdBy: BOB });
    registerMember("alice-phone", ALICE);
    registerMember("carol-other-project", member("carol"), { projectIds: ["project-b"] });
    follows.set(notificationReaderKey(ALICE), "agent-1", true);
    follows.set(notificationReaderKey(member("carol")), "agent-1", true);

    await finish(server);

    expect(delivered.flatMap((entry) => entry.tokens)).toEqual(["alice-phone"]);
  });

  it("a terminal notifies whoever launched it; an untracked terminal pages no Project Member", async () => {
    const { server, delivered, registerMember } = setup({});
    registerMember("alice-phone", ALICE);
    registerMember("bob-phone", BOB);
    recordTerminalLaunch("terminal-bob", { createdBy: BOB.id });
    const internals = asInternals<{
      broadcastTerminalAttention(params: Record<string, string>): Promise<void>;
    }>(server);

    for (const terminalId of ["terminal-bob", "terminal-untracked"])
      await internals.broadcastTerminalAttention({
        terminalId,
        cwd: "/tmp/worktree",
        workspaceId: WORKSPACE_ID,
        terminalName: "shell",
        reason: "finished",
      });
    await new Promise((resolve) => setImmediate(resolve));
    forgetTerminalLaunch("terminal-bob");

    expect(delivered.map((entry) => entry.tokens)).toEqual([["bob-phone"]]);
  });

  it.each([["legacy"], ["owned-subscription"]] as const)(
    "a %s connection that may not see the session gets no attention message or preview",
    async (kind) => {
      const { server } = setup({ createdBy: BOB });
      const modern = kind === "owned-subscription";
      const received = (published: unknown[], socket: ReturnType<typeof createOpenSocket>) =>
        modern ? published.length : socket.send.mock.calls.length;
      const outsiderPublished: unknown[] = [];
      const insiderPublished: unknown[] = [];
      const presence = {
        deviceType: "web" as const,
        appVisible: false,
        focusedAgentId: null,
        lastActivityAt: new Date(),
      };
      const outsider = connectClient(server, presence, {
        reader: memberReader(BOB, "all"),
        allowsResource: false,
        ...(modern ? { published: outsiderPublished } : {}),
      });
      const insider = connectClient(server, presence, {
        reader: memberReader(BOB, "all"),
        ...(modern ? { published: insiderPublished } : {}),
      });

      await finish(server);

      expect(received(outsiderPublished, outsider)).toBe(0);
      expect(received(insiderPublished, insider)).toBe(1);
    },
  );
});

/**
 * Legal acceptance (2026-11-04): who each push goes to, captured at the delivery hook just before
 * Expo, for every reason that can push. Readers and payloads are synthetic. Set
 * CLISBOT_PUSH_AUDIENCE_EVIDENCE to a file path to keep the captured matrix.
 */
describe("push audience before Expo", () => {
  const CAROL = member("carol");
  const DAVE = member("dave");
  const ERIN = member("erin");
  const FRANK = member("frank");
  const ADMIN = member("admin");

  function registerAudience(push: ReturnType<typeof createPushNotifications>, nowMs: number) {
    const lease = (token: string, projectIds: string[] | null, expiresInMs = 3_600_000) => ({
      leaseId: `lease-${token}`,
      leaseExpiresAt: nowMs + expiresInMs,
      projectIds,
    });
    push.renew("owner-phone");
    push.renew("bob-phone", lease("bob-phone", [PROJECT_ID]), { actor: BOB });
    push.renew("bob-tablet-off", lease("bob-tablet-off", [PROJECT_ID]), {
      actor: BOB,
      scope: "off",
    });
    push.renew("alice-mine", lease("alice-mine", [PROJECT_ID]), { actor: ALICE });
    push.renew("alice-all", lease("alice-all", [PROJECT_ID]), { actor: ALICE, scope: "all" });
    push.renew("carol-other-project-all", lease("carol", ["project-b"]), {
      actor: CAROL,
      scope: "all",
    });
    push.renew("admin-daemon-wide-mine", lease("admin", null), { actor: ADMIN });
    push.renew("dave-revoked-all", lease("dave-revoked-all", [PROJECT_ID]), {
      actor: DAVE,
      scope: "all",
    });
    push.revokeLease("lease-dave-revoked-all");
    push.renew("erin-expired-all", lease("erin", [PROJECT_ID], 1_000), {
      actor: ERIN,
      scope: "all",
    });
    push.renew("switched-phone", lease("switched-alice", [PROJECT_ID]), {
      actor: ALICE,
      scope: "all",
    });
    push.renew("switched-phone", lease("switched-frank", ["project-b"]), { actor: FRANK });
    push.renew("signed-out-phone", lease("signed-out", [PROJECT_ID]), { actor: BOB });
    push.revoke("signed-out-phone");
  }

  const AUTHOR_AUDIENCE = ["alice-all", "bob-phone", "owner-phone"];
  const cases = [
    {
      reason: "finished",
      assistant: "Synthetic summary for the author.",
      expected: AUTHOR_AUDIENCE,
    },
    { reason: "finished", assistant: null, expected: AUTHOR_AUDIENCE, label: "fallback" },
    { reason: "permission", assistant: null, expected: AUTHOR_AUDIENCE },
    { reason: "error", assistant: "Synthetic error.", expected: [] },
  ] as const;

  it.each(cases)("$reason ($label) reaches only allowed readers", async (testCase) => {
    let nowMs = Date.now();
    const captured: Array<{ tokens: string[]; payload: PushPayload }> = [];
    const dir = mkdtempSync(join(tmpdir(), "clisbot-push-before-expo-"));
    const push = createPushNotifications({
      logger: createStub<pino.Logger>(createLogger()),
      filePath: join(dir, "push-tokens.json"),
      now: () => nowMs,
      deliver: async (tokens, payload) => {
        captured.push({ tokens: [...tokens].sort(), payload });
      },
    });
    registerAudience(push, nowMs);
    nowMs += 5_000;
    const { server } = createServer(
      {
        getAgent: vi.fn(() => ({
          workspaceId: WORKSPACE_ID,
          createdBy: BOB,
          pendingPermissions: new Map(
            testCase.reason === "permission"
              ? [
                  [
                    "permission-1",
                    {
                      id: "permission-1",
                      provider: "claude",
                      name: "Bash",
                      kind: "tool",
                      title: "Run synthetic command",
                    },
                  ],
                ]
              : [],
          ),
        })),
        getLastAssistantMessage: vi.fn(async () => testCase.assistant),
      },
      push,
    );
    asInternals<{ projectIdForWorkspace: () => Promise<string> }>(server).projectIdForWorkspace =
      async () => PROJECT_ID;
    setHubLink(server, "connected");

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-1",
      provider: "claude",
      reason: testCase.reason,
    });
    await new Promise((resolve) => setImmediate(resolve));
    rmSync(dir, { recursive: true });

    const actual = captured.flatMap((entry) => entry.tokens);
    const evidencePath = process.env.CLISBOT_PUSH_AUDIENCE_EVIDENCE;
    if (evidencePath) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(
        evidencePath,
        `${JSON.stringify({
          reason: testCase.reason,
          label: "label" in testCase ? testCase.label : null,
          projectId: PROJECT_ID,
          createdBy: "member:bob",
          payloadBeforeExpo: captured[0]?.payload ?? null,
          expectedRecipients: testCase.expected,
          actualRecipients: actual,
        })}\n`,
      );
    }
    expect(actual).toEqual(testCase.expected);
    expect(captured.length).toBeLessThanOrEqual(1);
    if (testCase.reason === "permission")
      expect(captured[0]?.payload.body).toBe("Run synthetic command");
    if ("label" in testCase) expect(captured[0]?.payload.body).toBe("Finished working.");
  });
});

import { compileAudienceRule } from "../config/audience.js";
import { configurationDaemonStub } from "../daemon/test-support.js";
// COMPAT(clisbot-channels): targeted tests for the execution plane facade
// (plan §4-S2). Drives `createChannelPlane` end to end over the real ChannelStore
// (embedded PGlite) and a fake in-memory DaemonConnection: the kill switch, the
// first-mention bind, the shared stream consumer (permission events to the
// approval engine, turn events to the relay), start-time orphan recovery + the
// S10 posture assertion, and the approval-command short-circuit. The facade is
// the thin routing layer; these prove it composes the three engines correctly.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore, type RecordChannelInboundActivityInput } from "../../db/channels.js";
import type { AgentExecutionRecord } from "../../db/types.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSnapshot,
  CreateAgentConfig,
} from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { OPEN_AUDIENCE_ROUTE_LIMITS } from "../config/schema.js";
import type {
  ChannelPlaneDeps,
  InboundMessage,
  PlaneLogger,
  TypingParams,
} from "../plane/types.js";
import { planeInboundDeferral } from "../plane/types.js";
import { ManualClock } from "../plane/clock.js";
import {
  channelExecutionLabels,
  parseStoredRouteSelection,
  routeFingerprint,
} from "../bindings/index.js";
import { buttonValue, cardIdFor } from "../approvals/card.js";
import { mintChannelCommandButton } from "../command-buttons.js";
import { textCommandHelpText } from "../commands.js";
import { createChannelPlane } from "../execution.js";

const ORGANIZATION_ID = "channel-org";
const ACCOUNT_ID = "work";
const INITIATOR = "slack:U0ALICE";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  inbound: { reactionNotifications: "off", editNotifications: "off" },
  sync: {
    finalAnswers: true,
    progress: {
      progressMessage: false,
      typingIndicator: false,
      messageReaction: "off",
    },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

// Kind-level match: any channel conversation resolves this route.
function makeRoute(overrides: { approval?: CompiledRoute["approval"] } = {}): CompiledRoute {
  return {
    audienceRules: [],
    where: { dm: false, groups: ["all"], conversations: [] },
    target: {
      kind: "agent",
      agent: "worker",
      environment: "repo",
      template: null,
    },
    defaultRoles: ["interactor"],
    assignments: [{ identities: [INITIATOR], roles: ["commandApprover"] }],
    defaults: DEFAULTS,
    approval: overrides.approval ?? [
      { match: "file", mode: "auto-allow" },
      { match: "command", mode: "require", initiatorOnly: true },
      { match: "config", mode: "require" },
      { match: "*", mode: "auto-deny" },
    ],
  };
}

function makeAccount(route: CompiledRoute): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: "connection-id",
    transport: {},
    config: {},
    defaultRoles: ["interactor"],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    routes: [route],
  };
}

function makeControlPlane(account: CompiledChannelAccount): ChannelControlPlane {
  return {
    enabled: true,
    channelEnabled: {},
    roles: {
      interactor: {
        grants: ["bot.interact"],
        deny: [],
        extends: [],
        closure: ["interactor"],
      },
      commandApprover: {
        grants: ["bot.interact", "approval.command"],
        deny: [],
        extends: [],
        closure: ["commandApprover"],
      },
    },
    users: {
      "default-user": {
        name: null,
        identities: [INITIATOR],
      },
    },
    identityOwners: { [INITIATOR]: "default-user" },
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    accounts: [account],
  };
}

function snapshotOf(
  id: string,
  title: string | null,
  labels: Record<string, string> = {},
): AgentSnapshot {
  return {
    id,
    provider: "codex",
    cwd: "/tmp/repo",
    title,
    status: "idle",
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    labels,
  };
}

function makeFakeDaemon(
  listAgents: AgentSnapshot[] = [],
  options: {
    /** Recorded in call order so a test can assert what happened BEFORE the
     * daemon was touched: the processing lease opening, then the dispatch. */
    order?: string[];
    /** The daemon's first stream event, emitted from inside the send — the
     * race that made a turn_started-driven indicator invisible. */
    emitTurnStartedOnSend?: boolean | undefined;
    failCreate?: boolean | undefined;
    failSend?: boolean | undefined;
    onEvent?: ((agentId: string, event: Record<string, unknown>) => Promise<void>) | undefined;
  } = {},
) {
  const created: { config: CreateAgentConfig; title: string | null }[] = [];
  const messages: { agentId: string; text: string; steer: boolean | null }[] = [];
  const responses: {
    agentId: string;
    requestId: string;
    response: AgentPermissionResponse;
  }[] = [];
  const cancelled: string[] = [];
  let seq = 0;
  const daemon: DaemonConnection = {
    ...configurationDaemonStub(),
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async (config, opts) => {
      options.order?.push("create");
      if (options.failCreate === true) throw new Error("create refused");
      created.push({ config, title: opts?.title ?? null });
      const id = `agent-${seq++}`;
      return { agentId: id, agent: snapshotOf(id, opts?.title ?? null, opts?.labels ?? {}) };
    },
    sendAgentMessage: async (agentId, text, opts) => {
      options.order?.push("send");
      // The daemon starts the turn synchronously inside the delivery: its
      // turn_started reaches the plane BEFORE the send call has returned.
      if (options.emitTurnStartedOnSend === true) {
        await options.onEvent?.(agentId, {
          type: "turn_started",
          provider: "codex",
          turnId: `turn-${agentId}`,
        });
      }
      if (options.failSend === true) throw new Error("send refused");
      messages.push({ agentId, text, steer: opts?.steer ?? null });
    },
    cancelAgent: async (agentId) => {
      cancelled.push(agentId);
    },
    respondToAgentPermission: async (agentId, requestId, response) => {
      responses.push({ agentId, requestId, response });
    },
    listAgents: async () => listAgents,
    setTimelineSubscription: async () => {
      options.order?.push("subscribe");
    },
    stop: () => undefined,
  };
  return { daemon, created, messages, responses, cancelled };
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    senderIdentity: INITIATOR,
    text: "start the build",
    mentionedBot: true,
    conversation: {
      kind: "channel",
      id: "C0APP",
      rootConversationId: "C0APP",
      threadId: null,
    },
    ...overrides,
  };
}

interface FacadeHarness {
  plane: ReturnType<typeof createChannelPlane>;
  fake: ReturnType<typeof makeFakeDaemon>;
  posted: string[];
  /** The `threadId` of every outbound post (undefined = conversation root). */
  postedThreads: (string | undefined)[];
  /** Flip `ok` to false to make the vertical's outbound refuse every post. */
  postOutcome: { ok: boolean; error?: string };
  mediaPosted: string[];
  next: { message: InboundMessage | null };
  /** Every liveness drive, in wire order. */
  driven: TypingParams[];
  /** The daemon calls and the drives, interleaved in the order they happened. */
  order: string[];
  clock: ManualClock;
  workflowDispatches: Parameters<ChannelPlaneDeps["dispatchWorkflow"]>[0][];
  activity: RecordChannelInboundActivityInput[];
}

function makeHarness(
  opts: {
    envFlag?: boolean;
    account?: CompiledChannelAccount;
    controlPlane?: ChannelControlPlane;
    media?: { mediaPost?: boolean; homeRoot?: string; agentCwd?: string };
    /** The route's liveness leaves (default: indicator on, reaction off). */
    progress?: Partial<EffectiveDefaults["sync"]["progress"]>;
    daemonOptions?: Parameters<typeof makeFakeDaemon>[1];
    daemonAgents?: AgentSnapshot[];
    processingTtlMs?: number;
    resolveChannelSender?: ChannelPlaneDeps["resolveChannelSender"];
    authorizeChannelApproval?: ChannelPlaneDeps["authorizeChannelApproval"];
    consumeChannelIdentityChallenge?: ChannelPlaneDeps["consumeChannelIdentityChallenge"];
    channelRevisionId?: string;
    commandAccess?: ChannelPlaneDeps["commandAccess"];
    readWorkflowRuns?: ChannelPlaneDeps["readWorkflowRuns"];
    logger?: PlaneLogger;
  } = {},
): FacadeHarness {
  const progress: EffectiveDefaults["sync"]["progress"] = {
    progressMessage: false,
    typingIndicator: true,
    messageReaction: "off",
    ...opts.progress,
  };
  const liveRoute: CompiledRoute = {
    ...makeRoute(),
    defaults: { ...DEFAULTS, sync: { ...DEFAULTS.sync, progress } },
  };
  const account = opts.account ?? makeAccount(liveRoute);
  const controlPlane = opts.controlPlane ?? makeControlPlane(account);
  const driven: TypingParams[] = [];
  const order: string[] = [];
  const clock = new ManualClock(1_000);
  const fake = makeFakeDaemon(opts.daemonAgents ?? [], {
    order,
    onEvent: (agentId, event) => plane.onStreamEvent(agentId, event as never),
    ...opts.daemonOptions,
  });
  const posted: string[] = [];
  const postedThreads: (string | undefined)[] = [];
  const postOutcome: { ok: boolean; error?: string } = { ok: true };
  const mediaPosted: string[] = [];
  const workflowDispatches: Parameters<ChannelPlaneDeps["dispatchWorkflow"]>[0][] = [];
  const activity: RecordChannelInboundActivityInput[] = [];
  const next: { message: InboundMessage | null } = { message: null };
  const plane = createChannelPlane({
    organizationId: ORGANIZATION_ID,
    ...(opts.channelRevisionId === undefined ? {} : { channelRevisionId: opts.channelRevisionId }),
    accountScope: { channel: "slack", accountId: ACCOUNT_ID },
    dispatchWorkflow: async (input) => {
      workflowDispatches.push(input);
    },
    recordChannelInboundActivity: async (input) => {
      activity.push(input);
    },
    workflowOutputStore: {
      beginAgentExecutionOutput: async () => undefined,
      completeAgentExecutionOutput: async () => undefined,
      failAgentExecutionOutput: async () => false,
      findLatestChannelWorkflowExecution: async () => undefined,
    },
    normalizeInbound: () => next.message,
    envFlag: opts.envFlag ?? true,
    controlPlane,
    commandAccess: opts.commandAccess ?? {
      authorizeChannelPrivilege: async () => ({ allowed: true }),
      resolveChannelAgentConfigurations: async () => ({
        unrestricted: true,
        agentConfigurations: [],
      }),
      resolveChannelMember: async () => undefined,
    },
    ...(opts.readWorkflowRuns ? { readWorkflowRuns: opts.readWorkflowRuns } : {}),
    cancelWorkflowRuns: async () => {
      await fake.daemon.cancelAgent("workflow-agent");
      return 1;
    },
    ...(opts.resolveChannelSender === undefined
      ? {}
      : { resolveChannelSender: opts.resolveChannelSender }),
    ...(opts.authorizeChannelApproval === undefined
      ? {}
      : { authorizeChannelApproval: opts.authorizeChannelApproval }),
    ...(opts.consumeChannelIdentityChallenge === undefined
      ? {}
      : {
          consumeChannelIdentityChallenge: opts.consumeChannelIdentityChallenge,
        }),
    clock,
    logger: opts.logger ?? SILENT,
    ...(opts.processingTtlMs !== undefined ? { processingTtlMs: opts.processingTtlMs } : {}),
    typing: async (params) => {
      order.push(`typing:${params.action}`);
      driven.push(params);
    },
    post: async (p) => {
      posted.push(p.text);
      postedThreads.push(p.threadId);
      if (!postOutcome.ok) return { ok: false, error: postOutcome.error ?? "channel refused" };
      return { ok: true, externalMessageId: "1720000000.000001" };
    },
    // COMPAT(clisbot-control-plane): the native-media post (G7–G11). The
    // facade's plane-owned agentId→cwd map (recorded by the bindings engine's
    // `noteAgentCwd` at create) is what the relay's `agentCwd` resolver reads.
    mediaPost:
      opts.media?.mediaPost === true
        ? async (p) => {
            mediaPosted.push(p.filePath);
            return {
              ok: true,
              externalMessageId: `media-${mediaPosted.length}`,
            };
          }
        : undefined,
    homeRoot: opts.media?.homeRoot,
    resolveAgentSpec: () => ({
      provider: "codex",
      cwd: opts.media?.agentCwd ?? "/tmp/repo",
    }),
    resolveAgentAccessTarget: () => ({
      daemonReference: "daemon-1",
      projectId: "project-1",
    }),
  });
  return {
    plane,
    fake,
    posted,
    postedThreads,
    postOutcome,
    mediaPosted,
    next,
    driven,
    order,
    clock,
    workflowDispatches,
    activity,
  };
}

/** One running Workflow execution, in the shape `onWorkflowStreamEvent` reads:
 * the captured Channel location plus the route the Hub selected for it. */
function workflowExecution(input: {
  id: string;
  conversationId: string;
  route: CompiledRoute;
  /** Set to exercise the captured-route branch (a run started by this Hub). */
  captured?: { position: number };
  threadId?: string;
}): AgentExecutionRecord {
  const bindingKey = JSON.stringify(["slack", ACCOUNT_ID, input.conversationId, null]);
  return {
    id: input.id,
    organizationId: ORGANIZATION_ID,
    workflowId: "6dd62fdf-b621-4743-b027-101d9fd93be3",
    machineId: null,
    status: "running",
    startedAt: new Date(),
    completedAt: null,
    completedByAgentAt: null,
    deadlineAt: null,
    idleDeadlineAt: null,
    result: null,
    triggerContext: {},
    outputContext: {
      provider: "channel",
      channel: {
        name: "slack",
        account_id: ACCOUNT_ID,
        binding_key: bindingKey,
        external_conversation_id: input.conversationId,
        external_thread_id: input.threadId ?? null,
        sender_identity: INITIATOR,
        root_kind: "channel",
        trigger_thread_id: input.threadId ?? null,
        ...(input.captured === undefined
          ? {}
          : {
              route_position: input.captured.position,
              route_fingerprint: routeFingerprint(input.route),
            }),
        route: {
          defaultRoles: input.route.defaultRoles,
          assignments: input.route.assignments,
          defaults: input.route.defaults,
          approval: input.route.approval,
        },
      },
    },
    reactionState: null,
    configurationRevisionId: "50ca1f39-87eb-4348-b9b4-eb76081f95cd",
    completionTokenHash: null,
    replyClaimedAt: null,
    replyClaimCount: 0,
    outputEmissions: {},
    outputDeliveryAttempts: {},
    launchIntent: {
      triggerName: "engineering-assistant",
      allowOutputs: [],
    } as unknown as AgentExecutionRecord["launchIntent"],
    daemonId: null,
    daemonAgentId: "workflow-agent",
    workflowStepRunId: null,
    hubAction: null,
    hubActionCompletedAt: null,
    hubActionReadyAt: null,
    hubActionAcknowledgements: {
      terminalAt: null,
      idleAt: null,
      finishExecutionCall: null,
    },
  };
}

// --- Harness ---------------------------------------------------------------

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-execution-db-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Channel Org', 'channel-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

// --- Tests -----------------------------------------------------------------

describe("plane start (daemon session readiness)", () => {
  it("defers orphan recovery instead of failing the account when the daemon session is not ready", async () => {
    // External boot race (docs/audits/2026-09-10): the admission ticket's Hub
    // relationship can lag a cold boot past the start-time connect window. The
    // account must not be torn down — the socket keeps reconnecting and recovery
    // runs on the first connect.
    const started: string[] = [];
    const logger: PlaneLogger = {
      info: (msg: string) => started.push(msg),
      warn: () => undefined,
    };
    const harness = makeHarness({ logger });
    let connectCalls = 0;
    let releaseSecond: (() => void) | undefined;
    const gated: DaemonConnection = {
      ...harness.fake.daemon,
      waitForConnected: () => {
        connectCalls += 1;
        if (connectCalls === 1) {
          return Promise.reject(new Error("timed out waiting for daemon connection after 15000ms"));
        }
        return new Promise<void>((resolve) => {
          releaseSecond = resolve;
        });
      },
    };
    // Start resolves (account not torn down) even though the first connect rejected.
    const result = await harness.plane.start(gated, store);
    assert.deepEqual(result, { rebound: 0, leftPending: 0 });
    assert.equal(connectCalls, 2, "start must register a deferred wait for the next connect");
    assert.equal(
      started.includes("channel plane started"),
      false,
      "orphan recovery must not complete before the daemon connects",
    );
    // The daemon's first connect fires the deferred recovery.
    releaseSecond?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      started.includes("channel plane started"),
      true,
      "orphan recovery runs once the daemon session is established",
    );
  });
});

describe("workflow route", () => {
  it("uses text only for new selection and keeps an existing direct Agent binding", async () => {
    const direct = makeRoute();
    const workflow: CompiledRoute = {
      ...makeRoute(),
      audienceRules: [],
      where: { dm: false, groups: ["all"], conversations: [] },
      contains: "#triage",
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    const account: CompiledChannelAccount = {
      ...makeAccount(direct),
      routes: [workflow, direct],
    };
    const harness = makeHarness({
      account,
      channelRevisionId: "81ec5ff9-bb74-4277-b5d0-62c480a3f150",
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0TEXTROUTE",
      rootConversationId: "C0TEXTROUTE",
      threadId: null,
    };

    harness.next.message = message({
      text: "please #triage this",
      conversation,
    });
    const automated = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(automated.outcome?.kind, "workflow");
    assert.equal(harness.workflowDispatches.length, 1);
    assert.equal(harness.fake.created.length, 0);

    harness.next.message = message({
      text: "start a direct session",
      conversation,
    });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(bound.outcome?.kind, "bound");
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    const stored = await store.findThreadBinding(
      ORGANIZATION_ID,
      ACCOUNT_ID,
      conversation.rootConversationId,
      null,
    );
    assert.deepEqual(parseStoredRouteSelection(stored?.route), {
      revisionId: "81ec5ff9-bb74-4277-b5d0-62c480a3f150",
      position: 1,
      fingerprint: parseStoredRouteSelection(stored?.route)?.fingerprint,
    });

    harness.next.message = message({
      text: "now #triage appears",
      conversation,
    });
    const continued = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(continued.outcome?.kind, "steered");
    assert.equal(continued.outcome?.kind === "steered" ? continued.outcome.agentId : "", agentId);
    assert.equal(harness.workflowDispatches.length, 1, "the active Agent binding wins");
  });

  // Routing asks two questions and nothing else: which route owns this
  // conversation now, and does its target still match the bound session. A
  // config edit that answers neither must not disturb a live conversation.
  it("keeps steering a bound conversation after an unrelated config edit", async () => {
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0COSMETIC",
      rootConversationId: "C0COSMETIC",
      threadId: null,
    };
    const before = makeHarness({ channelRevisionId: "11111111-1111-4111-8111-111111111111" });
    await before.plane.start(before.fake.daemon, store);
    before.next.message = message({ text: "start", conversation });
    const bound = await before.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(bound.outcome?.kind, "bound");
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

    // The operator edits a presentation leaf and deploys a new revision. Same
    // route, same target — the conversation keeps its session.
    const edited: CompiledRoute = {
      ...makeRoute(),
      defaults: { ...DEFAULTS, sync: { ...DEFAULTS.sync, threadLink: "full" } },
    };
    const after = makeHarness({
      account: makeAccount(edited),
      channelRevisionId: "22222222-2222-4222-8222-222222222222",
    });
    await after.plane.start(after.fake.daemon, store);
    after.next.message = message({ text: "keep going", conversation });
    const steered = await after.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(steered.outcome?.kind, "steered");
    assert.equal(steered.outcome?.kind === "steered" ? steered.outcome.agentId : "", agentId);
    assert.equal(after.fake.created.length, 0, "no session is minted for an unrelated edit");
  });

  it("mints a session at the new target when the route is repointed", async () => {
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0RETARGET",
      rootConversationId: "C0RETARGET",
      threadId: null,
    };
    const before = makeHarness();
    await before.plane.start(before.fake.daemon, store);
    before.next.message = message({ text: "start", conversation });
    const bound = await before.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(bound.outcome?.kind, "bound");
    const first = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

    // The operator repoints the route at another agent. Reusing the bound
    // session would answer from an agent the configuration no longer names.
    const repointed: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "agent", agent: "reviewer", environment: "repo", template: null },
    };
    const after = makeHarness({ account: makeAccount(repointed) });
    await after.plane.start(after.fake.daemon, store);
    after.next.message = message({ text: "now what", conversation });
    const rebound = await after.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(rebound.outcome?.kind, "bound");
    const second = rebound.outcome?.kind === "bound" ? rebound.outcome.agentId : "";
    assert.equal(after.fake.created.length, 1, "a session is minted at the new target");
    assert.equal(
      after.fake.created[0]?.config.provider,
      "codex",
      "the new session is created, not steered",
    );
    assert.deepEqual(after.fake.cancelled, [first], "the session at the old target is retired");
    const stored = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0RETARGET", null);
    assert.equal(stored?.agentId, second);
  });

  it("retires the bound session when the conversation is routed to a Workflow", async () => {
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0TOWORKFLOW",
      rootConversationId: "C0TOWORKFLOW",
      threadId: null,
    };
    const before = makeHarness();
    await before.plane.start(before.fake.daemon, store);
    before.next.message = message({ text: "start", conversation });
    const bound = await before.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(bound.outcome?.kind, "bound");
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

    const workflowRoute: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    const after = makeHarness({ account: makeAccount(workflowRoute) });
    await after.plane.start(after.fake.daemon, store);
    after.next.message = message({ text: "now what", conversation });
    const dispatched = await after.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(dispatched.outcome?.kind, "workflow");
    assert.deepEqual(after.fake.cancelled, [agentId], "the replaced session is retired");
    assert.equal(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0TOWORKFLOW", null),
      undefined,
      "and its binding is released",
    );
  });

  it("goes silent when no route owns the conversation any more", async () => {
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0DROPPED",
      rootConversationId: "C0DROPPED",
      threadId: null,
    };
    const before = makeHarness();
    await before.plane.start(before.fake.daemon, store);
    before.next.message = message({ text: "start", conversation });
    assert.equal(
      (await before.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} }))
        .outcome?.kind,
      "bound",
    );

    // The route is narrowed to another Conversation: this conversation is no
    // longer served at all.
    const narrowed: CompiledRoute = {
      ...makeRoute(),
      audienceRules: [],
      where: { dm: false, groups: [], conversations: ["C0OTHER"] },
    };
    const after = makeHarness({ account: makeAccount(narrowed) });
    await after.plane.start(after.fake.daemon, store);
    after.next.message = message({ text: "anyone there", conversation });
    const ignored = await after.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(ignored.outcome?.kind, "ignored");
    assert.equal(after.fake.created.length, 0);
  });

  it("dispatches a durable workflow event without creating a direct agent binding", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
      defaultRoles: [],
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      externalMessageId: "1712000000.000123",
      conversation: {
        kind: "thread",
        id: "1712000000.000100",
        rootConversationId: "C0FLOW",
        threadId: "1712000000.000100",
      },
    });

    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.outcome?.kind, "workflow");
    assert.equal(harness.fake.created.length, 0);
    assert.equal(harness.workflowDispatches.length, 1);
    assert.equal(harness.workflowDispatches[0]!.payload.workflow, "engineering-assistant");
    assert.equal(harness.workflowDispatches[0]!.payload.channel.route_position, 0);
    assert.equal(
      harness.workflowDispatches[0]!.payload.channel.route_fingerprint,
      routeFingerprint(route),
    );
    assert.equal(
      harness.workflowDispatches[0]!.payload.channel.route.defaults.outbound.path,
      "relay",
    );
    assert.equal(
      harness.workflowDispatches[0]!.payload.channel.binding_key,
      JSON.stringify(["slack", ACCOUNT_ID, "C0FLOW", "1712000000.000100"]),
    );
  });

  it("applies mention and sender admission before dispatching a workflow", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
      defaultRoles: [],
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0WORKFLOW-ADMISSION",
      rootConversationId: "C0WORKFLOW-ADMISSION",
      threadId: null,
    };

    harness.next.message = message({ mentionedBot: false, conversation });
    const unmentioned = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.next.message = message({
      senderIdentity: "slack:U0STRANGER",
      conversation,
    });
    const unauthorized = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(unmentioned.outcome?.kind, "ignored");
    assert.equal(unauthorized.outcome?.kind, "ignored");
    assert.equal(harness.workflowDispatches.length, 0);
  });

  it("admits a Member through an audience rule when legacy Channel roles do not", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      audienceRules: [
        compileAudienceRule({ who: { roles: ["member"] }, where: { groups: "all" } }),
      ],
      target: { kind: "workflow", workflow: "engineering-assistant" },
      defaultRoles: [],
    };
    const account = makeAccount(route);
    const requests: Parameters<NonNullable<ChannelPlaneDeps["resolveChannelSender"]>>[0][] = [];
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
      resolveChannelSender: async (input) => {
        requests.push(input);
        return { membershipId: "membership-1", role: "member", teamIds: [] };
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({ senderIdentity: "slack:U0MEMBER" });

    const admitted = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(admitted.outcome?.kind, "workflow");
    assert.equal(harness.workflowDispatches.length, 1);
    assert.equal(requests[0]?.account.connectionId, account.connectionId);
    assert.equal(requests[0]?.senderIdentity, "slack:U0MEMBER");
    assert.equal(harness.activity.length, 1);
    assert.equal(harness.activity[0]?.outcome, "workflow");
    assert.equal(harness.activity[0]?.senderIdentity, "slack:U0MEMBER");
    assert.equal("text" in harness.activity[0]!, false);
  });

  it.each(["agent", "workflow"] as const)(
    "records a denied %s admission without executing",
    async (targetKind) => {
      for (const reason of ["sender may not trigger this route"]) {
        const base = makeRoute();
        const route: CompiledRoute = {
          ...base,
          defaultRoles: [],
          assignments: [],
          target:
            targetKind === "workflow"
              ? { kind: "workflow", workflow: "engineering-assistant" }
              : base.target,
        };
        const account = makeAccount(route);
        const harness = makeHarness({
          account,
          controlPlane: makeControlPlane(account),
          resolveChannelSender: async () => null,
        });
        await harness.plane.start(harness.fake.daemon, store);
        harness.next.message = message({ senderIdentity: "slack:U0UNLINKED" });
        const denied = await harness.plane.onInbound({
          channel: "slack",
          accountId: ACCOUNT_ID,
          ctxPayload: {},
        });
        assert.deepEqual(denied.outcome, { kind: "ignored", reason });
        assert.equal(harness.fake.created.length, 0);
        assert.equal(harness.workflowDispatches.length, 0);
        assert.equal(harness.activity.at(-1)?.outcomeDetail, reason);
        await harness.plane.stop();
      }
    },
  );

  it("consumes an identity-link command before route admission", async () => {
    const requests: Parameters<
      NonNullable<ChannelPlaneDeps["consumeChannelIdentityChallenge"]>
    >[0][] = [];
    const account = makeAccount(makeRoute());
    const harness = makeHarness({
      account,
      consumeChannelIdentityChallenge: async (input) => {
        requests.push(input);
        return "linked";
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      senderIdentity: "slack:U0NEW",
      senderName: "New Member",
      text: "<@B0BOT> /link ABCDE-23456",
    });

    const linked = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.deepEqual(requests, [
      {
        organizationId: ORGANIZATION_ID,
        account,
        senderIdentity: "slack:U0NEW",
        senderName: "New Member",
        code: "ABCDE-23456",
      },
    ]);
    assert.equal(linked.outcome?.kind, "command");
    assert.equal(linked.dispatched, true);
    assert.match(harness.posted[0] ?? "", /Identity linked/u);
    assert.equal(harness.fake.created.length, 0);
  });

  it("leaves an identity-link command addressed to no bot to the bot it names", async () => {
    let consumed = 0;
    const account = makeAccount(makeRoute());
    const harness = makeHarness({
      account,
      consumeChannelIdentityChallenge: async () => {
        consumed += 1;
        return "invalid";
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    for (const text of ["/link ABCDE-23456", "<@B0OTHER> /link ABCDE-23456"]) {
      harness.next.message = message({ mentionedBot: false, text });
      const outcome = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.deepEqual(outcome.outcome, {
        kind: "ignored",
        reason: "command not addressed to this bot",
      });
    }
    assert.equal(consumed, 0);
    assert.deepEqual(harness.posted, []);
    assert.equal(harness.fake.created.length, 0);

    harness.next.message = message({
      mentionedBot: false,
      text: "/link ABCDE-23456",
      conversation: { kind: "dm", id: "D0DM", rootConversationId: "D0DM", threadId: null },
    });
    await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    assert.equal(consumed, 1, "a DM always addresses this bot");
    await harness.plane.stop();
  });

  it("counts the follow-up window from the agent's latest stream activity", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: { ...DEFAULTS, followUp: { mode: "auto", ttlMinutes: 5 } },
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const inbound = (mentionedBot: boolean) => {
      harness.next.message = message({ mentionedBot, text: mentionedBot ? "start" : "more" });
      return harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    };

    const bound = await inbound(true);
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    // A long turn: its final event lands 4 minutes after the mention.
    harness.clock.advance(4 * 60_000);
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "long-turn",
    });
    harness.clock.advance(4 * 60_000);
    assert.equal((await inbound(false)).outcome?.kind, "steered");

    harness.clock.advance(6 * 60_000);
    assert.equal((await inbound(false)).outcome?.kind, "ignored");
    await harness.plane.stop();
  });

  it("applies follow-up mode and idle TTL to an existing workflow binding", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
      defaults: { ...DEFAULTS, followUp: { mode: "auto", ttlMinutes: 1 } },
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);

    harness.next.message = message();
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.next.message = message({ mentionedBot: false, text: "follow up" });
    const active = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.clock.advance(60_001);
    const idle = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(active.outcome?.kind, "workflow");
    assert.equal(idle.outcome?.kind, "ignored");
    assert.equal(harness.workflowDispatches.length, 2);
  });

  it("does not treat another Workflow's activity as an existing follow-up", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "first-workflow" },
      defaultRoles: [],
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);

    harness.next.message = message();
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    route.target = { kind: "workflow", workflow: "second-workflow" };
    harness.next.message = message({
      mentionedBot: false,
      text: "unmentioned",
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.outcome?.kind, "ignored");
    assert.equal(harness.workflowDispatches.length, 1);
  });
});

describe("selected-conversation audience", () => {
  function openRoute(conversationId: string): CompiledRoute {
    return {
      ...makeRoute(),
      audienceRules: [
        compileAudienceRule({ who: { anyone: true }, where: { conversations: [conversationId] } }),
      ],
      where: { dm: false, groups: [], conversations: [conversationId] },
      defaultRoles: [],
      assignments: [],
      approval: [{ match: "*", mode: "auto-deny" }],
      limits: OPEN_AUDIENCE_ROUTE_LIMITS,
    };
  }

  it("admits an unknown participant only when mentioned in the selected conversation", async () => {
    const conversationId = "C0PUBLIC-ADMISSION";
    const route = openRoute(conversationId);
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: conversationId,
      rootConversationId: conversationId,
      threadId: null,
    };

    harness.next.message = message({
      senderIdentity: "slack:U0EXTERNAL",
      mentionedBot: false,
      conversation,
    });
    const unmentioned = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.next.message = message({
      senderIdentity: "slack:U0EXTERNAL",
      mentionedBot: true,
      conversation,
    });
    const mentioned = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(unmentioned.outcome?.kind, "ignored");
    assert.equal(mentioned.outcome?.kind, "bound");
    assert.equal(harness.fake.created.length, 1);
  });

  it("records bounded open-audience outcomes and limit decisions without message text", async () => {
    const conversationId = "C0PUBLIC-AUDIT";
    const route = openRoute(conversationId);
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: conversationId,
      rootConversationId: conversationId,
      threadId: null,
    };

    harness.next.message = message({
      senderIdentity: "slack:U0EXTERNAL-AUDIT",
      mentionedBot: false,
      conversation,
      text: "private message content",
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.next.message = message({
      senderIdentity: "slack:U0EXTERNAL-AUDIT",
      mentionedBot: true,
      conversation,
      text: "x".repeat(8_001),
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(harness.activity.length, 2);
    assert.deepEqual(harness.activity[0], {
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      routePosition: 0,
      routeFingerprint: routeFingerprint(route),
      externalConversationId: conversationId,
      externalThreadId: null,
      senderIdentity: "slack:U0EXTERNAL-AUDIT",
      outcome: "ignored",
      outcomeDetail: "not mentioned; requireMention is on",
      limitDecision: "not_evaluated",
    });
    assert.equal(harness.activity[1]?.limitDecision, "denied");
    assert.match(harness.activity[1]?.limitReason ?? "", /size limit/u);
    assert.equal(JSON.stringify(harness.activity).includes("private message content"), false);
  });

  it("bounds public input size and accepted messages per sender", async () => {
    const conversationId = "C0PUBLIC-LIMITS";
    const route = openRoute(conversationId);
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: conversationId,
      rootConversationId: conversationId,
      threadId: null,
    };
    const external = {
      senderIdentity: "slack:U0RATE-LIMITED",
      mentionedBot: true,
      conversation,
    };

    harness.next.message = message({ ...external, text: "x".repeat(8_001) });
    const oversized = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(oversized.outcome?.kind, "ignored");
    assert.match(
      oversized.outcome?.kind === "ignored" ? oversized.outcome.reason : "",
      /size limit/u,
    );
    // Over the size ceiling for good: no deferral, so the durable ingress
    // completes the row instead of bringing the message back forever.
    assert.equal(oversized.deferred, undefined);
    assert.equal(planeInboundDeferral(oversized), undefined);

    for (let index = 0; index < 10; index += 1) {
      harness.next.message = message({ ...external, text: `request ${index}` });
      const accepted = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.notEqual(accepted.outcome?.kind, "ignored");
      await harness.plane.onStreamEvent("agent-0", {
        type: "turn_completed",
        provider: "codex",
        turnId: `public-${index}`,
      });
    }
    harness.next.message = message({ ...external, text: "one too many" });
    const limited = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(limited.outcome?.kind, "ignored");
    assert.match(limited.outcome?.kind === "ignored" ? limited.outcome.reason : "", /rate limit/u);
    // A rate ceiling clears with time: the refusal is back-pressure, and it
    // survives the untyped host boundary the supervisor reads it across.
    assert.ok((limited.deferred?.retryAfterMs ?? 0) > 0);
    assert.deepEqual(planeInboundDeferral(limited), limited.deferred);
  });

  it("counts session commands against the same limits and says why", async () => {
    const conversationId = "C0PUBLIC-COMMANDS";
    const route = {
      ...openRoute(conversationId),
      limits: { ...OPEN_AUDIENCE_ROUTE_LIMITS, maxConcurrentRuns: 1 },
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const external = {
      senderIdentity: "slack:U0COMMANDS",
      mentionedBot: true,
      conversation: {
        kind: "channel" as const,
        id: conversationId,
        rootConversationId: conversationId,
        threadId: null,
      },
    };
    const send = async (text: string, externalMessageId: string) => {
      harness.next.message = message({ ...external, text, externalMessageId });
      return harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    };

    const oversized = await send(`/quick ${"x".repeat(8_001)}`, "1700000000.100001");
    assert.equal(oversized.outcome?.kind, "ignored");
    assert.equal(harness.fake.created.length, 0);
    assert.match(harness.posted.at(-1) ?? "", /longer than this bot accepts/u);

    await send("/quick first question", "1700000000.100002");
    assert.equal(harness.fake.created.length, 1);
    const busy = await send("/quick second question", "1700000000.100003");
    assert.ok((busy.deferred?.retryAfterMs ?? 0) > 0);
    assert.equal(harness.fake.created.length, 1);
    assert.match(harness.posted.at(-1) ?? "", /queued/u);
    // A retry of the same message is not announced twice.
    const postedBefore = harness.posted.length;
    await send("/quick second question", "1700000000.100003");
    assert.equal(harness.posted.length, postedBefore);
  });

  it("cancels active public Route work when its configuration is replaced", async () => {
    const conversationId = "C0PUBLIC-REVOKE";
    const route = openRoute(conversationId);
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      senderIdentity: "slack:U0EXTERNAL",
      conversation: {
        kind: "channel",
        id: conversationId,
        rootConversationId: conversationId,
        threadId: null,
      },
    });
    const admitted = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(admitted.outcome?.kind, "bound");

    await harness.plane.stop({ cancelActive: true });

    assert.deepEqual(harness.fake.cancelled, ["agent-0"]);
  });
});

describe("kill switch (flag off)", () => {
  it("ingests nothing and binds nothing when isEnabled is false", async () => {
    const { plane, fake, posted, next } = makeHarness({ envFlag: false });
    await plane.start(fake.daemon, store);
    next.message = message({
      conversation: {
        kind: "channel",
        id: "C0OFF",
        rootConversationId: "C0OFF",
        threadId: null,
      },
    });

    const result = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.dispatched, false);
    assert.equal(result.outcome?.kind, "ignored");
    assert.match(result.outcome?.kind === "ignored" ? result.outcome.reason : "", /kill switch/u);
    assert.equal(fake.created.length, 0, "no agent created with the flag off");
    assert.equal(posted.length, 0, "nothing relayed with the flag off");
  });
});

describe("first-mention bind (flag on)", () => {
  it("binds an agent, delivers the first prompt, and attaches the stream", async () => {
    const { plane, fake, next } = makeHarness();
    await plane.start(fake.daemon, store);
    next.message = message({
      conversation: {
        kind: "channel",
        id: "C0BIND",
        rootConversationId: "C0BIND",
        threadId: null,
      },
    });

    const result = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.dispatched, true);
    assert.equal(result.outcome?.kind, "bound");
    const agentId = result.outcome?.kind === "bound" ? result.outcome.agentId : "";
    assert.equal(fake.created.length, 1, "one agent created");
    assert.equal(fake.messages.length, 1, "the first prompt delivered");
    assert.equal(fake.messages[0]?.text, "start the build");
    assert.equal(fake.messages[0]?.steer, false, "the first prompt does not steer");

    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0BIND", null);
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, agentId);
  });
});

describe("shared stream consumer", () => {
  async function bindAgent(
    externalConversationId: string,
    overrides: Partial<InboundMessage> = {},
  ) {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: externalConversationId,
        rootConversationId: externalConversationId,
        threadId: null,
      },
      ...overrides,
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.outcome?.kind, "bound");
    return {
      plane: harness.plane,
      posted: harness.posted,
      postedThreads: harness.postedThreads,
      agentId: result.outcome?.kind === "bound" ? result.outcome.agentId : "",
    };
  }

  it("routes a permission_requested to the approval engine (prompt posted)", async () => {
    const { plane, posted, agentId } = await bindAgent("C0PERM");
    const request: AgentPermissionRequest = {
      id: "req-perm",
      provider: "codex",
      name: "Bash",
      kind: "tool",
      input: { command: "ls -la" },
    };

    await plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request,
    });

    assert.equal(posted.length, 1, "the approval prompt is posted in-thread");
    assert.match(posted[0] ?? "", /approve req-perm/u);
  });

  it("routes a turn to the relay (final answer posted)", async () => {
    const { plane, posted, agentId } = await bindAgent("C0RELAY");

    await plane.onStreamEvent(agentId, {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "done" },
      turnId: "turn-1",
    });
    await plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-1",
    });

    assert.ok(posted.includes("done"), "the final answer is relayed");
  });

  it("mints the reply thread on a root marker under the thread anchor", async () => {
    const { plane, postedThreads, agentId } = await bindAgent("C0MINT", {
      externalMessageId: "1712000000.000003",
    });

    await plane.onStreamEvent(agentId, {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "minted" },
      turnId: "turn-mint",
    });
    await plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-mint",
    });

    assert.equal(postedThreads[0], "1712000000.000003", "the reply threads on the marker message");
  });

  it("never mints under the default anchor", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: { ...DEFAULTS, replyAnchor: "default" },
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({ externalMessageId: "1712000000.000006" });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.outcome?.kind, "bound");
    const agentId = result.outcome?.kind === "bound" ? result.outcome.agentId : "";

    await harness.plane.onStreamEvent(agentId, {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "at root" },
      turnId: "turn-nomint",
    });
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-nomint",
    });

    assert.equal(
      harness.postedThreads[0],
      undefined,
      "the root marker stays at the conversation root",
    );
  });

  it("follows the marker thread through the trigger when the binding collapses threads", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: { ...DEFAULTS, bindingKey: "channel", replyAnchor: "default" },
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      externalMessageId: "1712000000.000005",
      conversation: {
        kind: "thread",
        id: "1711000000.000002",
        rootConversationId: "C0COLLAPSE",
        threadId: "1711000000.000002",
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.outcome?.kind, "bound");
    const agentId = result.outcome?.kind === "bound" ? result.outcome.agentId : "";

    await harness.plane.onStreamEvent(agentId, {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "collapsed" },
      turnId: "turn-c1",
    });
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-c1",
    });

    assert.equal(
      harness.postedThreads[0],
      "1711000000.000002",
      "the marker's own thread carries the reply (binding collapsed to root)",
    );
  });

  it("routes a subagent frame to the relay under the subagent scope", async () => {
    // A route that opts into relaying subagent final answers.
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: {
        ...DEFAULTS,
        sync: {
          ...DEFAULTS.sync,
          subagents: { finalAnswers: true, progress: false, toolCalls: false },
        },
      },
    };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0SUB",
        rootConversationId: "C0SUB",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.outcome?.kind, "bound");
    const agentId = result.outcome?.kind === "bound" ? result.outcome.agentId : "";

    const frame = {
      type: "agent.provider_subagents.update",
      payload: {
        kind: "timeline",
        parentAgentId: agentId,
        subagentId: "sub-1",
        provider: "codex",
        item: { type: "assistant_message", text: "sub result" },
        timestamp: "2026-08-27T00:00:00.000Z",
        seq: 1,
        epoch: "e1",
      },
    };
    // The frame carries its own parentAgentId — the facade needs no agent id.
    await harness.plane.onSubagentFrame({
      type: "agent.provider_subagents.update",
      payload: {
        kind: "upsert",
        subagent: {
          id: "sub-1",
          parentAgentId: agentId,
          title: "Research",
          description: null,
          status: "running",
        },
      },
    });
    await harness.plane.onSubagentFrame(frame);
    await harness.plane.onSubagentFrame({
      type: "agent.provider_subagents.update",
      payload: { kind: "remove", parentAgentId: agentId, subagentId: "sub-1" },
    });

    assert.ok(
      harness.posted.includes("▶ Research (subagent): sub result"),
      "the subagent's answer is relayed with the scope prefix",
    );
    // An unattached parent is a no-op, and so is a non-subagent frame.
    await harness.plane.onSubagentFrame({
      ...frame,
      payload: { ...frame.payload, parentAgentId: "agent-unknown" },
    });
    await harness.plane.onSubagentFrame({ type: "agent_stream", payload: {} });
  });

  it.skip("relays the bound agent's local media through the recorded create-time cwd", async () => {
    // COMPAT(clisbot-control-plane): the create-time wiring (G7–G11) — the
    // bindings engine's `noteAgentCwd` records the created agent's `cwd` into
    // the plane-owned map, and the relay's `agentCwd` resolver reads it for
    // media-path extraction. The shared homeRoot is a DIFFERENT dir without
    // the file: a successful media post proves the agent's own cwd won.
    const agentHome = await mkdtemp(join(tmpdir(), "hub-exec-media-agent-"));
    const sharedHome = await mkdtemp(join(tmpdir(), "hub-exec-media-shared-"));
    const mediaFile = join(agentHome, "chart.png");
    await writeFile(mediaFile, "png");
    try {
      const harness = makeHarness({
        media: { mediaPost: true, homeRoot: sharedHome, agentCwd: agentHome },
      });
      await harness.plane.start(harness.fake.daemon, store);
      harness.next.message = message({
        conversation: {
          kind: "channel",
          id: "C0MEDIA",
          rootConversationId: "C0MEDIA",
          threadId: null,
        },
      });
      const bound = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.equal(bound.outcome?.kind, "bound");
      const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

      await harness.plane.onStreamEvent(agentId, {
        type: "timeline",
        provider: "codex",
        item: {
          type: "assistant_message",
          text: `rendered the chart:\n${mediaFile}\nand done`,
        },
        turnId: "turn-media",
      });
      await harness.plane.onStreamEvent(agentId, {
        type: "turn_completed",
        provider: "codex",
        turnId: "turn-media",
      });

      assert.deepEqual(harness.mediaPosted, [mediaFile], "the media post uses the agent's cwd");
      assert.ok(
        harness.posted.includes("rendered the chart:\nand done"),
        "the caption relays with the media path line stripped",
      );
      assert.ok(
        !harness.posted.some((text) => text.includes(mediaFile)),
        "no text post carries the raw media path",
      );
    } finally {
      await rm(agentHome, { recursive: true, force: true });
      await rm(sharedHome, { recursive: true, force: true });
    }
  });
});

describe("start-time recovery + posture", () => {
  it("never recovers another Channel account's pending binding", async () => {
    const pendingExecutionId = "6aac565d-081a-4124-a62b-f466d735ec3b";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: "other-account",
      externalConversationId: "-100777",
      externalThreadId: null,
      pendingExecutionId,
      initiator: "telegram:77",
      route: { kind: "group", id: "-100777" },
    });
    const surviving = snapshotOf(
      "telegram-agent",
      null,
      channelExecutionLabels(pendingExecutionId),
    );
    const harness = makeHarness({ daemonAgents: [surviving] });

    await harness.plane.start(harness.fake.daemon, store);

    const untouched = await store.findThreadBinding(
      ORGANIZATION_ID,
      "other-account",
      "-100777",
      null,
    );
    assert.equal(untouched?.status, "pending");
  });

  it("recovers an orphan marker and re-attaches its stream", async () => {
    const executionId = "exec-recovery";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0REC",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-100", null, channelExecutionLabels(executionId));
    const { plane, posted } = makeHarness();

    const recovered = await plane.start(makeFakeDaemon([surviving]).daemon, store);

    assert.deepEqual(recovered, { rebound: 1, leftPending: 0 });

    // The recovered agent's stream is re-attached: a turn event relays into its thread.
    await plane.onStreamEvent("agent-100", {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "still here" },
      turnId: "turn-rec",
    });
    await plane.onStreamEvent("agent-100", {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-rec",
    });
    assert.ok(posted.includes("still here"), "the re-attached stream relays the final answer");
  });

  it("starts with a route that auto-allows every permission request", async () => {
    const lax = makeRoute({ approval: [{ match: "*", mode: "auto-allow" }] });
    const { plane, fake } = makeHarness({ account: makeAccount(lax) });
    await assert.doesNotReject(async () => plane.start(fake.daemon, store));
  });
});

describe("approval-command short-circuit", () => {
  it("answers an in-thread prompt from the channel when the responder is authorized", async () => {
    const { plane, fake, next } = makeHarness();
    await plane.start(fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0CMD",
      rootConversationId: "C0CMD",
      threadId: null,
    };
    next.message = message({ conversation });
    const bound = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

    // Open a prompt for a command-class tool (require, initiator-only).
    await plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request: {
        id: "req-cmd",
        provider: "codex",
        name: "Bash",
        kind: "tool",
        input: { command: "ls" },
      },
    });

    // The initiator answers in-thread.
    next.message = message({ text: "approve req-cmd", conversation });
    const answered = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(answered.outcome?.kind, "command");
    assert.equal(answered.outcome?.kind === "command" ? answered.outcome.handled : false, true);

    const response = fake.responses.at(-1);
    assert.equal(response?.agentId, agentId);
    assert.equal(response?.requestId, "req-cmd");
    assert.equal(response?.response.behavior, "allow");
  });
  it("accepts a current Project approval privilege when legacy Channel roles do not", async () => {
    const route: CompiledRoute = { ...makeRoute(), assignments: [] };
    const requests: Parameters<NonNullable<ChannelPlaneDeps["authorizeChannelApproval"]>>[0][] = [];
    const harness = makeHarness({
      account: makeAccount(route),
      authorizeChannelApproval: async (input) => {
        requests.push(input);
        return true;
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0MANAGED-APPROVAL",
      rootConversationId: "C0MANAGED-APPROVAL",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    await harness.plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request: {
        id: "req-managed",
        provider: "codex",
        name: "Bash",
        kind: "tool",
        input: { command: "ls" },
      },
    });

    harness.next.message = message({
      text: "approve req-managed",
      conversation,
    });
    const answered = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(answered.outcome?.kind, "command");
    assert.equal(answered.outcome?.kind === "command" && answered.outcome.handled, true);
    assert.deepEqual(requests[0]?.target, {
      daemonReference: "daemon-1",
      projectId: "project-1",
    });
    assert.equal(requests[0]?.privilege, "approval.command");
    assert.equal(harness.fake.responses.at(-1)?.requestId, "req-managed");
  });
});

describe("channel session commands", () => {
  it("uses the daemon cancellation RPC for /stop instead of replacing the turn", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0STOP",
      rootConversationId: "C0STOP",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    const promptCount = harness.fake.messages.length;

    harness.next.message = message({ text: "/stop", conversation });
    const stopped = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.deepEqual(harness.fake.cancelled, [agentId]);
    assert.equal(harness.fake.messages.length, promptCount, "stop must not create an empty turn");
    assert.equal(stopped.outcome?.kind, "command");
    assert.equal(stopped.outcome?.kind === "command" ? stopped.outcome.handled : false, true);
  });

  it("does not let an unauthorized sender inspect or stop a bound Agent", async () => {
    const route: CompiledRoute = { ...makeRoute(), defaultRoles: [] };
    const account = makeAccount(route);
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0STOPAUTH",
      rootConversationId: "C0STOPAUTH",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    harness.next.message = message({
      text: "/stop",
      senderIdentity: "slack:U0STRANGER",
      conversation,
    });
    const stopped = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.deepEqual(harness.fake.cancelled, []);
    assert.equal(stopped.outcome?.kind, "command");
    assert.equal(stopped.outcome?.kind === "command" ? stopped.outcome.handled : true, false);
  });

  // The captured-Workflow command branch runs a session command without ever
  // reaching the route selection, so it has to run the route's `access:` gate
  // itself: it used to hand `/help` (and `/stop`) to a sender the route refuses.
  it("refuses a session command from a sender the Workflow route's access block denies", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
      defaults: {
        ...DEFAULTS,
        access: { groupPolicy: "allowlist", allowFrom: ["U0ALICE"] },
      },
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const execution = workflowExecution({
      id: "0f5f2b3f-77c2-4a54-9f3a-4e5d7f2c1a90",
      conversationId: "C0WFACCESS",
      route,
    });
    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-agent",
      event: { type: "turn_started", provider: "codex", turnId: "workflow-turn" },
    });

    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0WFACCESS",
      rootConversationId: "C0WFACCESS",
      threadId: null,
    };
    // The allowlisted sender proves this is the captured-Workflow branch.
    harness.next.message = message({ text: "/help", conversation });
    const allowed = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(allowed.outcome?.kind, "command");
    assert.deepEqual(harness.posted, [textCommandHelpText("workflow")]);

    harness.next.message = message({
      text: "/help",
      senderIdentity: "slack:U0STRANGER",
      conversation,
    });
    const refused = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(refused.outcome?.kind, "command");
    assert.deepEqual(harness.posted, [
      textCommandHelpText("workflow"),
      textCommandHelpText("workflow"),
    ]);
  });

  it("returns every automation run with actual Host links without consulting the local daemon", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "multi-host" },
    };
    const requests: Parameters<NonNullable<ChannelPlaneDeps["readWorkflowRuns"]>>[0][] = [];
    const harness = makeHarness({
      account: makeAccount(route),
      readWorkflowRuns: async (input) => {
        requests.push(input);
        return [
          {
            id: "run-a",
            status: "running",
            steps: [{ id: "build", status: "running", agentId: "agent-a", serverId: "host-a" }],
          },
          {
            id: "run-b",
            status: "running",
            steps: [
              { id: "review", status: "pending" },
              { id: "test", status: "running", agentId: "agent-b", serverId: "host-b" },
            ],
          },
        ];
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    for (const text of ["/status", "/cowork"]) {
      harness.next.message = message({
        text,
        conversation: {
          kind: "channel",
          id: "C0MULTIHOST",
          rootConversationId: "C0MULTIHOST",
          threadId: null,
        },
      });
      const result = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.equal(result.outcome?.kind, "command", JSON.stringify(result.outcome));
      assert.match(harness.posted.at(-1)!, /run-a.*running/s);
      assert.match(harness.posted.at(-1)!, /paseo:\/\/h\/host-a\/agent\/agent-a/);
      assert.match(harness.posted.at(-1)!, /paseo:\/\/h\/host-b\/agent\/agent-b/);
      assert.match(harness.posted.at(-1)!, /review: pending/);
    }
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.workflowName, "multi-host");
    assert.equal(harness.fake.created.length, 0);
    await harness.plane.stop();
  });

  // The captured-route branch: a run this Hub started records its route, and
  // later events attach while a route still wires that Workflow to the
  // conversation. The Workflow output records the ROOT conversation, so a route
  // declared at the thread level must still be recognised.
  it("keeps attaching a workflow stream to a thread-level route", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      audienceRules: [],
      where: { dm: false, groups: ["all"], conversations: [] },
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const execution = workflowExecution({
      id: "0f0a3d1e-2f2b-4a39-9c5a-9c1d6ad4c111",
      conversationId: "C0WFTHREAD",
      threadId: "1712000000.000500",
      route,
      captured: { position: 0 },
    });

    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-thread-agent",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "ok" },
      },
    });

    // A run whose Route no longer wires it here is rejected by cancelling its
    // agent; an attached run is left alone.
    assert.deepEqual(harness.fake.cancelled, [], "the run stays attached");
    await harness.plane.stop();
  });

  it("stops attaching a workflow stream once the route no longer targets it", async () => {
    const captured: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    // The operator repointed the conversation at a direct agent route.
    const harness = makeHarness({ account: makeAccount(makeRoute()) });
    await harness.plane.start(harness.fake.daemon, store);
    const execution = workflowExecution({
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      conversationId: "C0WFGONE",
      route: captured,
      captured: { position: 0 },
    });

    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-gone-agent",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "ok" },
      },
    });

    assert.deepEqual(harness.fake.cancelled, ["workflow-gone-agent"], "the run is rejected");
    assert.equal(harness.posted.length, 0, "nothing is relayed for a Workflow the route dropped");
    await harness.plane.stop();
  });

  // Tiers: Route 1 (a direct Agent for a narrower audience) also covers the
  // conversation. A run started on Route 2 stays with Route 2, the same way a
  // bound conversation keeps the Route its binding recorded.
  it("keeps a workflow run on its recorded Route when an earlier Route also covers it", async () => {
    const earlier = makeRoute();
    const workflowRoute: CompiledRoute = {
      ...makeRoute(),
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    const account = { ...makeAccount(earlier), routes: [earlier, workflowRoute] };
    const harness = makeHarness({ account });
    await harness.plane.start(harness.fake.daemon, store);
    const execution = workflowExecution({
      id: "3c9e8f0a-6b1d-4e2f-9a7c-5d4b3a2f1e0d",
      conversationId: "C0WFTIER",
      route: workflowRoute,
      captured: { position: 1 },
    });

    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-tier-agent",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "ok" },
      },
    });

    assert.deepEqual(harness.fake.cancelled, [], "the run stays on Route 2");
    await harness.plane.stop();
  });

  it("uses captured Workflow context for approval callbacks and /stop", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      audienceRules: [],
      where: { dm: false, groups: ["all"], conversations: [] },
      contains: "#triage",
      target: { kind: "workflow", workflow: "engineering-assistant" },
    };
    const harness = makeHarness({ account: makeAccount(route) });
    await harness.plane.start(harness.fake.daemon, store);
    const execution = workflowExecution({
      id: "8cf44c32-8cde-4f3e-94a1-d3bf861cb716",
      conversationId: "C0WFSTOP",
      route,
    });
    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-agent",
      event: {
        type: "turn_started",
        provider: "codex",
        turnId: "workflow-turn",
      },
    });
    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-agent",
      event: {
        type: "permission_requested",
        provider: "codex",
        request: {
          id: "workflow-request",
          provider: "codex",
          name: "Bash",
          kind: "tool",
          input: { command: "ls" },
        },
      },
    });
    const answered = await harness.plane.onApprovalCallback({
      channel: "slack",
      accountId: ACCOUNT_ID,
      senderIdentity: INITIATOR,
      cardValue: "allow:workflow-request",
      externalConversationId: "C0WFSTOP",
      externalThreadId: null,
      rootKind: "channel",
    });
    assert.equal(answered.outcome?.kind, "command");
    assert.equal(answered.outcome?.kind === "command" ? answered.outcome.handled : false, true);
    assert.equal(harness.fake.responses.at(-1)?.agentId, "workflow-agent");

    harness.next.message = message({
      text: "/stop",
      conversation: {
        kind: "channel",
        id: "C0WFSTOP",
        rootConversationId: "C0WFSTOP",
        threadId: null,
      },
    });

    const stopped = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.deepEqual(harness.fake.cancelled, ["workflow-agent"]);
    assert.equal(stopped.outcome?.kind, "command");
    assert.equal(stopped.outcome?.kind === "command" ? stopped.outcome.handled : false, true);
    const postsBeforeUndeclaredOutput = harness.posted.length;
    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-agent",
      event: {
        type: "timeline",
        provider: "codex",
        turnId: "workflow-turn",
        item: {
          type: "assistant_message",
          text: "must not escape without allow_outputs",
        },
      },
    });
    await harness.plane.onWorkflowStreamEvent({
      execution,
      agentId: "workflow-agent",
      event: {
        type: "turn_completed",
        provider: "codex",
        turnId: "workflow-turn",
      },
    });
    assert.equal(
      harness.posted.length,
      postsBeforeUndeclaredOutput,
      "outputContext alone does not grant reply authority",
    );

    const staleExecution = {
      ...execution,
      id: "5d809c9d-502c-4848-9972-e3860e8dfc20",
      outputContext: {
        provider: "channel",
        channel: {
          ...(
            execution.outputContext as {
              channel: Record<string, unknown>;
            }
          ).channel,
          route_position: 0,
          route_fingerprint: "stale-route-fingerprint",
        },
      },
    };
    await harness.plane.onWorkflowStreamEvent({
      execution: staleExecution,
      agentId: "stale-workflow-agent",
      event: {
        type: "turn_started",
        provider: "codex",
        turnId: "stale-turn",
      },
    });
    // The Route was edited (new fingerprint) but still owns the conversation at
    // the recorded position and still names this Workflow, so the run keeps its
    // output. Its `contains` marker selects new runs only; it never gates output.
    assert.deepEqual(harness.fake.cancelled, ["workflow-agent"]);
  });
});

// --- The processing lease (sync.progress liveness) -------------------------
// The bug these pin: the surface used to open on turn_started, which the plane
// cannot reliably observe because it sends the prompt before the stream is
// subscribed. Every case below drives a REAL inbound through the facade with a
// daemon that emits turn_started synchronously inside the delivery.

describe("processing lease (accepted inbound opens it)", () => {
  /** Let the controller's fire-and-forget drive promises settle. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  it("raises the surface for a new agent BEFORE the daemon is dispatched", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.order.length = 0;
    harness.next.message = message({
      externalMessageId: "1712000000.000010",
      conversation: {
        kind: "channel",
        id: "C0LEASE",
        rootConversationId: "C0LEASE",
        threadId: null,
      },
    });

    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.equal(result.outcome?.kind, "bound");
    // The lease opens first, then the session is subscribed, then the prompt
    // is delivered — the order that makes the indicator visible.
    assert.deepEqual(harness.order, ["typing:start", "create", "subscribe", "send"]);
    assert.deepEqual(
      harness.driven.map((d) => [d.action, d.to, d.indicator]),
      [["start", "C0LEASE", true]],
    );
  });

  it("closes the surface on the turn's terminal event", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0CLOSE",
      rootConversationId: "C0CLOSE",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    await settle();
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start"],
    );

    // turn_started alone must NOT close or re-open anything (it is only a
    // liveness touch), and the terminal event closes the surface.
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-1",
    });
    await settle();
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("raises the surface for a follow-up steer before the daemon dispatch", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0STEER",
      rootConversationId: "C0STEER",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";
    // End the first turn so the follow-up opens a surface of its own (a live
    // one is shared, which the refcount test below pins).
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-first",
    });
    await settle();
    harness.order.length = 0;

    harness.next.message = message({
      text: "and then the tests",
      conversation,
    });
    const steered = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.equal(steered.outcome?.kind, "steered");
    assert.deepEqual(harness.order, ["typing:start", "subscribe", "send"]);
  });

  it("never raises the surface for a message the plane did not admit", async () => {
    // A route with no default role: only the assigned initiator may trigger it.
    const closedRoute: CompiledRoute = { ...makeRoute(), defaultRoles: [] };
    const account = makeAccount({
      ...closedRoute,
      defaults: {
        ...DEFAULTS,
        sync: {
          ...DEFAULTS.sync,
          progress: {
            progressMessage: false,
            typingIndicator: true,
            messageReaction: "off",
          },
        },
      },
    });
    const harness = makeHarness({
      account,
      controlPlane: makeControlPlane(account),
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0DENY",
      rootConversationId: "C0DENY",
      threadId: null,
    };

    // Not mentioned (requireMention is on).
    harness.next.message = message({ mentionedBot: false, conversation });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    // A text command.
    harness.next.message = message({ text: "/status", conversation });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    // A sender the route does not admit.
    harness.next.message = message({
      senderIdentity: "slack:U0STRANGER",
      conversation,
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.deepEqual(harness.driven, [], "no surface for a turn that never runs");
    assert.equal(harness.fake.created.length, 0);
  });

  it("releases the surface when the agent create fails", async () => {
    const harness = makeHarness({ daemonOptions: { failCreate: true } });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0FAIL",
        rootConversationId: "C0FAIL",
        threadId: null,
      },
    });

    // A throw, not an `ignored` outcome: the durable ingress retries the
    // message instead of completing it unanswered.
    await assert.rejects(
      harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} }),
    );
    await settle();

    // The start reached the wire (the lease opened before the create), so the
    // failed turn must have taken it back down.
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("releases the surface when the prompt delivery fails", async () => {
    const harness = makeHarness({ daemonOptions: { failSend: true } });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0SENDFAIL",
        rootConversationId: "C0SENDFAIL",
        threadId: null,
      },
    });

    // A throw, not an `ignored` outcome: the durable ingress retries the
    // message instead of completing it unanswered.
    await assert.rejects(
      harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} }),
    );
    await settle();

    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("releases the surface when a turn stops reporting (the TTL)", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
      processingTtlMs: 5_000,
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0TTL",
        rootConversationId: "C0TTL",
        threadId: null,
      },
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start"],
    );

    // Past the TTL with no stream event: the sweep closes it. The controller
    // sweeps on a real interval, so drive the tick through the clock seam.
    harness.clock.advance(6_000);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("one indicator per surface: two inbounds in one thread share it", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0TWO",
      rootConversationId: "C0TWO",
      threadId: null,
    };

    harness.next.message = message({ conversation });
    const first = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    harness.next.message = message({ text: "second", conversation });
    const second = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.equal(first.outcome?.kind, "bound");
    assert.equal(second.outcome?.kind, "steered");
    // Two leases, ONE wire start (the second inbound joins the live surface).
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start"],
    );

    // The agent's terminal event ends both leases, so the indicator goes once
    // and is never left running by the lease the event did not name.
    const agentId = first.outcome?.kind === "bound" ? first.outcome.agentId : "";
    await harness.plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-a",
    });
    await settle();
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("drives nothing when both liveness leaves are off", async () => {
    const harness = makeHarness({
      progress: { typingIndicator: false, messageReaction: "off" },
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0OFF2",
        rootConversationId: "C0OFF2",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.equal(result.outcome?.kind, "bound", "the turn still runs");
    assert.deepEqual(harness.driven, []);
  });

  it("carries the reaction leaf to the wire alongside the indicator", async () => {
    const harness = makeHarness({
      progress: { messageReaction: "hourglass_flowing_sand" },
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      externalMessageId: "1712000000.000077",
      conversation: {
        kind: "channel",
        id: "C0REACT",
        rootConversationId: "C0REACT",
        threadId: null,
      },
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();

    assert.deepEqual(
      harness.driven.map((d) => [d.action, d.indicator, d.reactionEmoji, d.messageId]),
      [["start", true, "hourglass_flowing_sand", "1712000000.000077"]],
    );
  });

  it("plane stop releases every open surface", async () => {
    const harness = makeHarness({
      daemonOptions: { emitTurnStartedOnSend: true },
    });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: "C0STOP",
        rootConversationId: "C0STOP",
        threadId: null,
      },
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    await settle();
    await harness.plane.stop();
    await settle();
    assert.deepEqual(
      harness.driven.map((d) => d.action),
      ["start", "stop"],
    );
  });
});

// --- Inbound families (slice 23a) ------------------------------------------

describe("inbound event kinds", () => {
  /** An always-reply route: no mention needed, so nothing but the family
   * itself can keep a system event away from the agent. */
  function alwaysReplyHarness() {
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: { ...DEFAULTS, requireMention: false },
    };
    const account = makeAccount(route);
    return makeHarness({ account, controlPlane: makeControlPlane(account) });
  }

  const ROOM_EVENTS = [
    { kind: "reaction", body: "Slack reaction added: :+1: by U0ALICE in C0ROOM msg 1.2" },
    { kind: "member", body: "Slack: U0ALICE joined C0ROOM." },
    { kind: "channel", body: "Slack channel renamed: #room." },
    { kind: "pin", body: "Slack: U0ALICE pinned a message in C0ROOM." },
    { kind: "delete", body: "Slack: a message was deleted in C0ROOM." },
    { kind: "topic", body: '[Topic] created "deploys"' },
    { kind: "poll_answer", body: "[Poll answer] poll p1 options [0]" },
    { kind: "edit", body: "[Edited] start the build" },
  ] as const;

  for (const room of ROOM_EVENTS) {
    it(`never starts a turn for a ${room.kind} event, even in always-reply mode`, async () => {
      const harness = alwaysReplyHarness();
      await harness.plane.start(harness.fake.daemon, store);
      harness.next.message = message({
        text: room.body,
        mentionedBot: false,
        conversation: {
          kind: "channel",
          id: `C0ROOM-${room.kind}`,
          rootConversationId: `C0ROOM-${room.kind}`,
          threadId: null,
        },
      });
      const result = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: { EventKind: room.kind },
      });
      assert.equal(result.dispatched, false);
      assert.equal(result.outcome?.kind, "ignored");
      assert.equal(harness.fake.created.length, 0);
      assert.equal(harness.fake.messages.length, 0);
      assert.equal(harness.posted.length, 0);
    });
  }

  it("records a room event against the route that owns the conversation", async () => {
    const harness = alwaysReplyHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "Slack: U0ALICE joined C0LEDGER.",
      mentionedBot: false,
      conversation: {
        kind: "channel",
        id: "C0LEDGER",
        rootConversationId: "C0LEDGER",
        threadId: null,
      },
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "member" },
    });
    const recorded = harness.activity.at(-1);
    assert.equal(recorded?.outcome, "ignored");
    assert.equal(recorded?.outcomeDetail, "channel member event does not start an agent turn");
  });

  it("keeps a reaction out of the ledger at the org floor", async () => {
    const harness = alwaysReplyHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "Slack reaction added: :+1: by U0ALICE in C0QUIET msg 1.2",
      mentionedBot: false,
      conversation: {
        kind: "channel",
        id: "C0QUIET",
        rootConversationId: "C0QUIET",
        threadId: null,
      },
    });
    await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "reaction" },
    });
    assert.equal(harness.activity.length, 0);
  });

  it("re-runs an edited message as a message when the route asks for it", async () => {
    const route: CompiledRoute = {
      ...makeRoute(),
      defaults: {
        ...DEFAULTS,
        inbound: { reactionNotifications: "off", editNotifications: "all" },
      },
    };
    const account = makeAccount(route);
    const harness = makeHarness({ account, controlPlane: makeControlPlane(account) });
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "[Edited] start the build",
      conversation: {
        kind: "channel",
        id: "C0EDIT",
        rootConversationId: "C0EDIT",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "edit" },
    });
    assert.equal(result.outcome?.kind, "bound");
    assert.equal(harness.fake.created.length, 1);
  });

  it("runs a native slash command through the shared command handler", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    // Slack's slash body carries no leading `/` — the verb is a structured fact.
    harness.next.message = message({
      text: "<@U0ALICE> help",
      conversation: {
        kind: "channel",
        id: "C0SLASH",
        rootConversationId: "C0SLASH",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {
        EventKind: "command",
        EventFacts: { command: { name: "help", args: "" } },
      },
    });
    assert.equal(result.outcome?.kind, "command");
    assert.equal((result.outcome as { detail?: string }).detail, "help");
    assert.match(harness.posted[0] ?? "", /\/status/u);
    assert.equal(harness.fake.created.length, 0);
  });

  // D-W4-04: `/help` reported `handled: true` whatever the outbound did, so a
  // reply that never reached the channel was indistinguishable in hub.log from
  // a delivered one. The proof is the POST, not the outcome flag.
  it("posts the /help text into the conversation that asked for it", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "/help",
      conversation: {
        kind: "thread",
        id: "1712000000.000900",
        rootConversationId: "C0HELP",
        threadId: "1712000000.000900",
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.dispatched, true);
    assert.equal(result.outcome?.kind, "command");
    assert.equal((result.outcome as { detail?: string }).detail, "help");
    assert.deepEqual(harness.posted, [textCommandHelpText()]);
    assert.match(harness.posted[0] ?? "", /\/status/u);
    assert.match(harness.posted[0] ?? "", /\/new/u);
    // Commands answer where they were asked, never at the conversation root.
    assert.deepEqual(harness.postedThreads, ["1712000000.000900"]);
    assert.equal(harness.fake.created.length, 0);
  });

  it("answers a command outside a DM only when it names this bot", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const inbound = () =>
      harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });

    harness.next.message = message({ text: "/help", mentionedBot: false });
    assert.deepEqual((await inbound()).outcome, {
      kind: "ignored",
      reason: "command not addressed to this bot",
    });
    assert.deepEqual(harness.posted, []);

    harness.next.message = message({
      text: "/help",
      mentionedBot: false,
      conversation: { kind: "dm", id: "D0HELP", rootConversationId: "D0HELP", threadId: null },
    });
    assert.equal((await inbound()).outcome?.kind, "command");

    harness.next.message = message({ text: "<@B0BOT> /help", mentionedBot: true });
    assert.equal((await inbound()).outcome?.kind, "command");
    assert.equal(harness.posted.length, 2);
    await harness.plane.stop();
  });

  it("changes and reports this conversation's follow-up mode with /followup", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    // Inside a thread: a root-level marker keys its own minted thread under `reply.anchor: thread`.
    const conversation: InboundMessage["conversation"] = {
      kind: "thread",
      id: "1712000000.000100",
      rootConversationId: "C0FOLLOWUP",
      threadId: "1712000000.000100",
    };
    const run = async (text: string, externalMessageId: string) => {
      harness.next.message = message({ text, conversation, externalMessageId });
      await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
      return harness.posted.at(-1) ?? "";
    };

    assert.match(await run("/followup pause", "1712000000.000101"), /^Follow-up paused/u);
    const paused = await run("/followup", "1712000000.000102");
    assert.match(paused, /`paused` until the next mention/u);
    assert.match(await run("/followup auto", "1712000000.000103"), /set to `auto`/u);
    assert.match(
      await run("/followup resume", "1712000000.000104"),
      /^Follow-up for this thread reset to the route's/u,
    );
    assert.doesNotMatch(await run("/followup status", "1712000000.000105"), /- here:/u);
    await harness.plane.stop();
  });

  it("refuses a conversation /followup at a channel root that would open its own thread", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "/followup auto",
      externalMessageId: "1712000000.000200",
      conversation: {
        kind: "channel",
        id: "C0FOLLOWROOT",
        rootConversationId: "C0FOLLOWROOT",
        threadId: null,
      },
    });
    await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    assert.match(harness.posted.at(-1) ?? "", /Run \/followup inside the thread/u);
    const key = {
      organizationId: ORGANIZATION_ID,
      channel: "slack" as const,
      accountId: ACCOUNT_ID,
      externalConversationId: "C0FOLLOWROOT",
      externalThreadId: "1712000000.000200",
    };
    assert.equal(await store.access.findConversationFollowUp(key), undefined);
    await harness.plane.stop();
  });

  it("hands prose that starts with followup to the agent instead of a usage reply", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({ text: "followup on the PR review please" });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.notEqual(result.outcome?.kind, "command");
    assert.equal(
      harness.posted.some((text) => text.startsWith("Usage:")),
      false,
    );
    await harness.plane.stop();
  });

  it("reports /help as unhandled when the reply never reached the channel", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.postOutcome.ok = false;
    harness.next.message = message({
      text: "/help",
      conversation: {
        kind: "channel",
        id: "C0HELPFAIL",
        rootConversationId: "C0HELPFAIL",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.dispatched, false);
    assert.equal(result.outcome?.kind === "command" ? result.outcome.handled : true, false);
    assert.equal(
      (result.outcome as { detail?: string }).detail,
      "help reply not delivered",
      "an undelivered answer must not be logged as handled",
    );
    assert.deepEqual(harness.posted, [textCommandHelpText()]);
  });

  it("posts the /status snapshot of the bound agent to the channel", async () => {
    // The fake daemon mints ids in order, so the first bind is `agent-0`.
    const harness = makeHarness({ daemonAgents: [snapshotOf("agent-0", "Nightly build")] });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0STATUSPOST",
      rootConversationId: "C0STATUSPOST",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal((bound.outcome as { agentId: string }).agentId, "agent-0");
    const postsBefore = harness.posted.length;

    harness.next.message = message({ text: "/status", conversation });
    const status = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "command", EventFacts: { command: { name: "status", args: "" } } },
    });
    assert.equal((status.outcome as { detail?: string }).detail, "status");
    const answer = harness.posted[postsBefore] ?? "";
    assert.match(answer, /Agent: Nightly build \(codex\)/u);
    assert.match(answer, /Status: idle/u);
    assert.match(answer, /Working directory: \/tmp\/repo/u);
    assert.deepEqual(harness.postedThreads[postsBefore], undefined);
  });

  it("reports /status as unhandled when the reply never reached the channel", async () => {
    const harness = makeHarness({ daemonAgents: [snapshotOf("agent-0", "Nightly build")] });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0STATUSFAIL",
      rootConversationId: "C0STATUSFAIL",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    harness.postOutcome.ok = false;
    harness.next.message = message({ text: "/status", conversation });
    const status = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "command", EventFacts: { command: { name: "status", args: "" } } },
    });
    assert.equal(status.dispatched, false);
    assert.equal(
      (status.outcome as { detail?: string }).detail,
      "status reply not delivered",
      "an undelivered snapshot must not be logged as handled",
    );
  });

  it("ignores an unknown command that did not address the bot", async () => {
    const harness = alwaysReplyHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "/deploy staging",
      mentionedBot: false,
      conversation: {
        kind: "channel",
        id: "C0UNKNOWN",
        rootConversationId: "C0UNKNOWN",
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {
        EventKind: "command",
        EventFacts: { command: { name: "deploy", args: "staging" } },
      },
    });
    assert.equal(result.dispatched, false);
    assert.equal(harness.fake.created.length, 0);
  });

  it("stops the running turn on /stop and releases the session on /new", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0SESSION",
      rootConversationId: "C0SESSION",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(bound.outcome?.kind, "bound");
    const agentId = (bound.outcome as { agentId: string }).agentId;

    harness.next.message = message({ text: "/stop", conversation });
    const stopped = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "command", EventFacts: { command: { name: "stop", args: "" } } },
    });
    assert.equal(stopped.outcome?.kind, "command");
    assert.deepEqual(harness.fake.cancelled, [agentId]);
    // The binding survives a stop: the conversation still belongs to the agent.
    assert.notEqual(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0SESSION", null),
      undefined,
    );

    harness.next.message = message({ text: "/new", conversation });
    const reset = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: { EventKind: "command", EventFacts: { command: { name: "new", args: "" } } },
    });
    assert.equal(reset.dispatched, true);
    assert.equal(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0SESSION", null),
      undefined,
    );

    // The next message mints a new session rather than steering the old one.
    harness.next.message = message({ conversation });
    const fresh = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(fresh.outcome?.kind, "bound");
    assert.notEqual((fresh.outcome as { agentId: string }).agentId, agentId);
  });

  it("routes an approval-card callback to the approval seam", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0CARD",
      rootConversationId: "C0CARD",
      threadId: null,
    };
    harness.next.message = message({ text: "edit the config", conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = (bound.outcome as { agentId: string }).agentId;
    const request: AgentPermissionRequest = {
      id: "req-card",
      provider: "codex",
      name: "Bash",
      kind: "tool",
      input: { command: "ls -la" },
    };
    await harness.plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request,
    });
    const cardId = cardIdFor(request);
    harness.next.message = message({
      text: "Slack action: approval value allow by U0ALICE on msg 1.2",
      conversation,
    });
    const clicked = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {
        EventKind: "callback",
        EventFacts: {
          callback: {
            actionId: "approval",
            value: buttonValue("allow", cardId),
            actorId: "U0ALICE",
            messageId: "1.2",
          },
        },
      },
    });
    assert.equal(clicked.outcome?.kind, "command");
    assert.equal((clicked.outcome as { handled: boolean }).handled, true);
    assert.equal(harness.fake.responses.length, 1);
    assert.equal(harness.fake.responses[0]?.requestId, "req-card");
  });

  it("ignores an injected command button this Hub never minted", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0INJECT",
      rootConversationId: "C0INJECT",
      threadId: null,
    };
    harness.next.message = message({ text: "bind me", conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = (bound.outcome as { agentId: string }).agentId;
    // A `message` tool call can put any text in a button. `/new` arriving as a
    // callback action id must never reach the session commands.
    harness.next.message = message({ text: "Slack action: /new by U0MALLORY", conversation });
    const clicked = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {
        EventKind: "callback",
        EventFacts: { callback: { actionId: "/new", actorId: "U0MALLORY" } },
      },
    });
    assert.equal(clicked.dispatched, false);
    assert.equal((clicked.outcome as { handled: boolean }).handled, false);
    assert.equal(
      (clicked.outcome as { detail?: string }).detail?.includes("unknown"),
      true,
      (clicked.outcome as { detail?: string }).detail,
    );
    // The session survived: nothing was reset.
    harness.next.message = message({ text: "still here", conversation });
    const after = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal((after.outcome as { agentId: string }).agentId, agentId);
  });

  it("runs a minted command button for its issuing actor, once", async () => {
    const harness = makeHarness({ daemonAgents: [snapshotOf("agent-0", "Nightly build")] });
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0MINTED",
      rootConversationId: "C0MINTED",
      threadId: null,
    };
    harness.next.message = message({ text: "bind me", conversation });
    const bound = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const token = mintChannelCommandButton("/status", {
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      agentId: (bound.outcome as { agentId: string }).agentId,
      conversationId: "C0MINTED",
      allowedActorIds: ["U0ALICE"],
    });
    const click = async (actorId: string) => {
      harness.next.message = message({ text: `Slack action: button by ${actorId}`, conversation });
      return await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {
          EventKind: "callback",
          EventFacts: { callback: { actionId: token, actorId } },
        },
      });
    };
    const foreign = await click("U0MALLORY");
    assert.equal((foreign.outcome as { handled: boolean }).handled, false);
    assert.equal((foreign.outcome as { detail?: string }).detail?.includes("foreign-actor"), true);
    const owned = await click("U0ALICE");
    assert.equal((owned.outcome as { kind: string }).kind, "command");
    assert.equal((owned.outcome as { detail?: string }).detail, "status");
    const replayed = await click("U0ALICE");
    assert.equal((replayed.outcome as { handled: boolean }).handled, false);
    assert.equal((replayed.outcome as { detail?: string }).detail?.includes("unknown"), true);
  });

  it("ignores a callback whose action this Hub never posted", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "Slack action: some_other_app_button by U0ALICE on msg 1.2",
      conversation: {
        kind: "channel",
        id: "C0FOREIGN",
        rootConversationId: "C0FOREIGN",
        threadId: null,
      },
    });
    const clicked = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {
        EventKind: "callback",
        EventFacts: {
          callback: {
            actionId: "some_other_app_button",
            value: "not-a-card-value",
            actorId: "U0ALICE",
          },
        },
      },
    });
    assert.equal(clicked.dispatched, false);
    assert.equal(
      (clicked.outcome as { detail?: string }).detail?.includes("unknown callback"),
      true,
    );
    assert.equal(harness.fake.created.length, 0);
  });
  it("keeps public discovery available while denying ungranted mutations", async () => {
    const harness = makeHarness({
      commandAccess: {
        authorizeChannelPrivilege: async () => ({ allowed: false, reason: "no grant" }),
        resolveChannelAgentConfigurations: async () => ({
          unrestricted: false,
          agentConfigurations: [],
        }),
        resolveChannelMember: async () => undefined,
      },
    });
    await harness.plane.start(harness.fake.daemon, store);
    for (const text of ["/help", "/me", "/model gpt-5.6-luna"]) {
      harness.next.message = message({
        text,
        conversation: {
          kind: "channel",
          id: "C0PUBLICCOMMANDS",
          rootConversationId: "C0PUBLICCOMMANDS",
          threadId: null,
        },
      });
      await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    }
    assert.match(harness.posted[0]!, /Commands:/);
    assert.match(harness.posted[1]!, /Guest/);
    assert.match(harness.posted[2]!, /needs Project access \(agent\.interact\)/);
    assert.equal(harness.fake.created.length, 0);
  });

  it("routes a new prompt and a dynamic command through normal agent delivery", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0DYNAMIC",
      rootConversationId: "C0DYNAMIC",
      threadId: null,
    };
    for (const text of [
      "/new initial work",
      "/command add inspect-code Review the code",
      "/inspect-code carefully",
    ]) {
      harness.next.message = message({ text, conversation });
      const outcome = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.equal(outcome.dispatched, true);
    }
    assert.equal(harness.fake.created.length, 1);
    assert.match(harness.fake.messages[0]!.text, /initial work/);
    assert.match(harness.fake.messages[1]!.text, /Review the code\n\ncarefully/);
  });

  it("stages a provider change without losing the conversation that can be forked", async () => {
    const harness = makeHarness({ daemonAgents: [snapshotOf("agent-0", "Context")] });
    harness.fake.daemon.listProviderModes = async () => [
      { id: "auto", label: "Auto", isUnattended: false },
    ];
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0STAGED",
      rootConversationId: "C0STAGED",
      threadId: null,
    };
    harness.next.message = message({ conversation });
    await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    harness.next.message = message({ text: "/provider claude", conversation });
    const staged = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(staged.dispatched, true);
    assert.equal(
      (await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0STAGED", null))?.agentId,
      "agent-0",
    );
    assert.equal(harness.fake.cancelled.length, 0);
    assert.match(harness.posted.at(-1)!, /Provider staged/);
    const create = harness.fake.daemon.createAgent;
    harness.fake.daemon.createAgent = async (config, options) => {
      const created = await create(config, options);
      return { agentId: "staged-fork-id", agent: { ...created.agent, id: "staged-fork-id" } };
    };
    harness.next.message = message({ text: "/fork keep the context", conversation });
    const fork = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(fork.dispatched, true, JSON.stringify(fork.outcome));
    assert.equal(harness.fake.created.at(-1)?.config.provider, "claude");
    assert.equal(
      (await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0STAGED", null))?.agentId,
      "staged-fork-id",
    );
  });

  it("consumes a replayed session command without creating or sending twice", async () => {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      text: "/new once",
      externalMessageId: "1720000010.000001",
      conversation: {
        kind: "channel",
        id: "C0RECEIPT",
        rootConversationId: "C0RECEIPT",
        threadId: null,
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await harness.plane.onInbound({
        channel: "slack",
        accountId: ACCOUNT_ID,
        ctxPayload: {},
      });
      assert.equal(outcome.dispatched, true, JSON.stringify(outcome.outcome));
    }
    assert.equal(harness.fake.created.length, 1);
    assert.equal(harness.fake.messages.length, 1);
  });
  it("starts a session with an inherited selection without re-checking the sender", async () => {
    const harness = makeHarness({
      commandAccess: {
        authorizeChannelPrivilege: async (request) =>
          request.privilege.startsWith("approval.")
            ? { allowed: false, reason: "Approval authority is required" }
            : { allowed: true },
        resolveChannelAgentConfigurations: async () => ({
          unrestricted: false,
          agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
        }),
        resolveChannelMember: async () => undefined,
      },
    });
    harness.fake.daemon.listProviderModes = async () => [
      { id: "default", label: "Default", isUnattended: false },
      { id: "full-access", label: "Full", isUnattended: true },
    ];
    await harness.plane.start(harness.fake.daemon, store);
    const conversation = {
      kind: "channel" as const,
      id: "C0UNATTENDED",
      rootConversationId: "C0UNATTENDED",
      threadId: null,
    };
    await store.access.setConversationSelection(
      {
        organizationId: ORGANIZATION_ID,
        channel: "slack",
        accountId: ACCOUNT_ID,
        externalConversationId: conversation.rootConversationId,
        externalThreadId: null,
      },
      {
        selectedProvider: "codex",
        selectedModel: "default",
        selectedMode: "full-access",
        selectedBy: "another-member",
      },
    );
    harness.next.message = message({ text: "/new work", conversation });
    await harness.plane.onInbound({ channel: "slack", accountId: ACCOUNT_ID, ctxPayload: {} });
    // The selection was checked against the Member who made it; the next
    // sender only needs chat authority to start a session with it.
    assert.equal(harness.fake.created.length, 1);
    assert.equal(harness.fake.created[0]?.config.modeId, "full-access");
    await harness.plane.stop();
  });
});

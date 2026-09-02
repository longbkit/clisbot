// COMPAT(clisbot-control-plane): the shared engine test harness for the two
// approval suites (`approvals.test.ts` — the P0 text-mode scenarios — and
// `approvals-cards.test.ts` — native-card gating, question prompts E5, the
// exactly-once race). One harness definition, both files import it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { AgentPermissionRequest, AgentPermissionResponse } from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import { ManualClock } from "../plane/clock.js";
import type { PlaneLogger, StreamContext } from "../plane/types.js";
import { ApprovalEngine } from "./index.js";

export const ORGANIZATION_ID = "channel-org";
export const ACCOUNT_ID = "work";
export const INITIATOR = "slack:U0ALICE";
export const APPROVER = "slack:U0BOB"; // has the class privilege, is NOT the initiator
export const BYSTANDER = "slack:U0CAROL"; // may interact, but has no approval.<class>
export const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

export function makeRoute(): CompiledRoute {
  return {
    match: { kind: "channel", ids: ["C0APP"] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: ["interactor"],
    assignments: [
      { identities: [INITIATOR], roles: ["commandApprover"] },
      { identities: [APPROVER], roles: ["commandApprover"] },
    ],
    defaults: DEFAULTS,
    approval: [
      { match: "file", mode: "auto-allow" },
      { match: "command", mode: "require", initiatorOnly: true },
      { match: "config", mode: "require" },
      { match: "*", mode: "auto-deny" },
    ],
  };
}

/** The route a question-kind request rides: `AskUserQuestion` classifies to
 * the `other` class, which the default route auto-denies via `*` — the E5
 * fixture prompts it instead (S10 holds: `other` stays approval-required). */
export function questionRoute(): CompiledRoute {
  const route = makeRoute();
  return {
    ...route,
    approval: [
      { match: "file", mode: "auto-allow" },
      { match: "command", mode: "require", initiatorOnly: true },
      { match: "config", mode: "require" },
      { match: "other", mode: "require" },
    ],
    // The question prompts (class `other`) are answerable by the same two
    // approvers the `command` prompts are.
    assignments: [
      ...route.assignments,
      { identities: [INITIATOR, APPROVER], roles: ["otherApprover"] },
    ],
  };
}

export function makeAccount(route: CompiledRoute): CompiledChannelAccount {
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
    fallback: { deny: true },
  };
}

function makeControlPlane(account: CompiledChannelAccount): ChannelControlPlane {
  return {
    enabled: true,
    channelEnabled: {},
    roles: {
      interactor: { grants: ["bot.interact"], deny: [], extends: [], closure: ["interactor"] },
      commandApprover: {
        grants: ["bot.interact", "approval.command"],
        deny: [],
        extends: [],
        closure: ["commandApprover"],
      },
      otherApprover: {
        grants: ["bot.interact", "approval.other"],
        deny: [],
        extends: [],
        closure: ["otherApprover"],
      },
    },
    users: {},
    identityOwners: {},
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    accounts: [account],
  };
}

function makeFakeDaemon() {
  const responses: { agentId: string; requestId: string; response: AgentPermissionResponse }[] = [];
  const daemon: DaemonConnection = {
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async () => ({
      agentId: "agent-0",
      agent: {
        id: "agent-0",
        provider: "codex",
        cwd: "/tmp",
        title: null,
        status: "idle",
        createdAt: "",
        updatedAt: "",
        labels: {},
      },
    }),
    sendAgentMessage: async () => undefined,
    cancelAgent: async () => undefined,
    respondToAgentPermission: async (agentId, requestId, response) => {
      responses.push({ agentId, requestId, response });
    },
    listAgents: async () => [],
    setTimelineSubscription: async () => undefined,
    stop: () => undefined,
  };
  return { daemon, responses };
}

export function requestOf(overrides: Partial<AgentPermissionRequest> = {}): AgentPermissionRequest {
  return { id: "req-1", provider: "codex", name: "Edit", kind: "tool", ...overrides };
}

/** A question-kind request (E5: AskUserQuestion) — the answers the daemon
 * normalizes are keyed by the FULL question text. */
export function questionRequestOf(
  overrides: Partial<AgentPermissionRequest> = {},
): AgentPermissionRequest {
  return {
    id: "req-q",
    provider: "codex",
    name: "AskUserQuestion",
    kind: "question",
    input: {
      questions: [
        {
          question: "Which formatter should the repo use?",
          options: [{ label: "Biome", description: "the repo default" }, "Prettier"],
          allowOther: true,
        },
      ],
    },
    ...overrides,
  };
}

/** One captured outbound post (text + optional native card payload). */
export interface CapturedPost {
  text: string;
  threadId?: string;
  blocks?: Record<string, unknown>[];
  replyMarkup?: Record<string, unknown>;
}

/** One captured in-place update (the card's decided state). */
export interface CapturedUpdate {
  text: string;
  externalMessageId: string;
  clearCard?: boolean;
}

export interface EngineHarness {
  engine: ApprovalEngine;
  context: StreamContext;
  posted: string[];
  postCalls: CapturedPost[];
  updateCalls: CapturedUpdate[];
  responses: { agentId: string; requestId: string; response: AgentPermissionResponse }[];
}

/** The account's `transport` (the `inlineButtons` card gate) — absent = off. */
export function makeEngine(
  store: ChannelStore,
  clock = new ManualClock(),
  route = makeRoute(),
  transport: Record<string, unknown> = {},
): EngineHarness {
  const account = { ...makeAccount(route), transport };
  const posted: string[] = [];
  const postCalls: CapturedPost[] = [];
  const updateCalls: CapturedUpdate[] = [];
  const { daemon, responses } = makeFakeDaemon();
  const engine = new ApprovalEngine({
    organizationId: ORGANIZATION_ID,
    controlPlane: makeControlPlane(account),
    logger: SILENT,
    clock,
    store,
    daemon,
    post: async (p) => {
      posted.push(p.text);
      postCalls.push({
        text: p.text,
        ...(p.threadId !== undefined ? { threadId: p.threadId } : {}),
        ...(p.blocks !== undefined ? { blocks: p.blocks } : {}),
        ...(p.replyMarkup !== undefined ? { replyMarkup: p.replyMarkup } : {}),
      });
      return { ok: true, externalMessageId: "1720000000.000001" };
    },
    update: async (p) => {
      updateCalls.push({
        text: p.text,
        externalMessageId: p.externalMessageId,
        ...(p.clearCard !== undefined ? { clearCard: p.clearCard } : {}),
      });
      return { ok: true };
    },
  });
  const context: StreamContext = {
    agentId: "agent-1",
    channel: "slack",
    accountId: ACCOUNT_ID,
    externalConversationId: "C0APP",
    externalThreadId: null,
    initiator: INITIATOR,
    account,
    route,
    // The `inlineButtons` dm/group gate decides on the binding's stored
    // route-summary kind (`channel` root here → the "group" surface).
    rootKind: "channel",
  };
  engine.bindStream(context);
  return { engine, context, posted, postCalls, updateCalls, responses };
}

// --- Store lifecycle (one PGlite per test FILE, opened in beforeAll) --------

export interface StoreHandle {
  store: ChannelStore;
  close: () => Promise<void>;
}

export async function openStore(): Promise<StoreHandle> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hub-approvals-db-"));
  const bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Channel Org', 'channel-org')`,
    [ORGANIZATION_ID],
  );
  const store = new ChannelStore(bundle.runtime);
  return {
    store,
    close: async () => {
      await bundle.runtime.close();
      await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

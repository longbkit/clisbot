// COMPAT(clisbot-channels): targeted tests for the approval engine (plan §4-S6).
// Drives the real ChannelStore (embedded PGlite) against a fake in-memory
// DaemonConnection: a `permission_requested` on the shared stream path classifies
// the tool class, auto-responds on the daemon for auto-allow / auto-deny, and
// posts an in-thread prompt otherwise. A prompt's answer is re-authorized at the
// approval exit (the SECOND authority check): an approver without the class
// privilege is inert, `initiatorOnly` locks the answer to the thread's initiator,
// and the S10 posture (no route auto-allows every class) is asserted at start.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
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
import { ApprovalEngine, assertChannelPosture, parseApprovalCommand, promptText } from "./index.js";
import { ApprovalPostureError } from "../policy.js";

const ORGANIZATION_ID = "channel-org";
const ACCOUNT_ID = "work";
const INITIATOR = "slack:U0ALICE";
const APPROVER = "slack:U0BOB"; // has the class privilege, is NOT the initiator
const BYSTANDER = "slack:U0CAROL"; // may interact, but has no approval.<class>
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  sync: { finalAnswers: true, progress: false, toolCalls: false, threadLink: "final-only" },
};

function makeRoute(): CompiledRoute {
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

function makeAccount(route: CompiledRoute): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    secretRef: "secret-ref",
    transport: {},
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
    respondToAgentPermission: async (agentId, requestId, response) => {
      responses.push({ agentId, requestId, response });
    },
    listAgents: async () => [],
    setTimelineSubscription: async () => undefined,
    stop: () => undefined,
  };
  return { daemon, responses };
}

function requestOf(overrides: Partial<AgentPermissionRequest> = {}): AgentPermissionRequest {
  return { id: "req-1", provider: "codex", name: "Edit", kind: "tool", ...overrides };
}

interface EngineHarness {
  engine: ApprovalEngine;
  context: StreamContext;
  posted: string[];
}

function makeEngine(
  store: ChannelStore,
  clock = new ManualClock(),
  route = makeRoute(),
): EngineHarness {
  const account = makeAccount(route);
  const posted: string[] = [];
  const { daemon } = makeFakeDaemon();
  const engine = new ApprovalEngine({
    organizationId: ORGANIZATION_ID,
    controlPlane: makeControlPlane(account),
    logger: SILENT,
    clock,
    store,
    daemon,
    post: async (p) => {
      posted.push(p.text);
      return { ok: true, nativeMessageId: "1720000000.000001" };
    },
  });
  const context: StreamContext = {
    agentId: "agent-1",
    channel: "slack",
    accountId: ACCOUNT_ID,
    conversationId: "C0APP",
    externalThreadId: null,
    initiator: INITIATOR,
    account,
    route,
  };
  engine.bindStream(context);
  return { engine, context, posted };
}

// --- Harness ---------------------------------------------------------------

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-approvals-db-"));
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

// --- parseApprovalCommand (pure) -------------------------------------------

describe("parseApprovalCommand", () => {
  it("parses approve / deny with a request id", () => {
    assert.deepEqual(parseApprovalCommand("approve req-42"), {
      decision: "allow",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("  deny req-42 "), {
      decision: "deny",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("approve a.b_c-1"), {
      decision: "allow",
      requestId: "a.b_c-1",
    });
  });
  it("rejects anything that is not a command", () => {
    assert.equal(parseApprovalCommand("please approve"), null);
    assert.equal(parseApprovalCommand("approve"), null);
    assert.equal(parseApprovalCommand("approve !bad-id!"), null);
    assert.equal(parseApprovalCommand("maybe req-1"), null);
  });
});

// --- auto-allow / auto-deny ------------------------------------------------

describe("auto-allow / auto-deny", () => {
  it("auto-allows a file-class request on the daemon, posting nothing", async () => {
    const { engine, posted } = makeEngine(store);
    await engine.handlePermissionRequest("agent-1", requestOf({ id: "req-file", name: "Edit" }));
    assert.equal(posted.length, 0, "an auto-allowed request posts no prompt");
  });

  it("auto-denies an unmatched-class request on the daemon, posting nothing", async () => {
    const { engine, posted } = makeEngine(store);
    // `WebFetch` classifies to `other`, which the `*` rule auto-denies.
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-other", name: "WebFetch" }),
    );
    assert.equal(posted.length, 0, "an auto-denied request posts no prompt");
  });
});

// --- prompt (in-thread) ----------------------------------------------------

describe("prompt (in-thread)", () => {
  it("posts an in-thread prompt for a require-class request", async () => {
    const { engine, posted } = makeEngine(store);
    // `Bash` with a plain command classifies to `command` → require, initiatorOnly.
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-cmd", name: "Bash", input: { command: "ls -la" } }),
    );
    assert.equal(posted.length, 1, "the prompt is posted");
    assert.match(posted[0] ?? "", /approve req-cmd/u);
    assert.match(posted[0] ?? "", /deny req-cmd/u);
  });

  it("marks the prompt initiator-only in its text", () => {
    const text = promptText(requestOf({ id: "req-cmd", name: "Bash" }), true);
    assert.match(text, /Only the person who started this thread can answer\./u);
  });

  it("does not answer an unbound agent's request (no context)", async () => {
    const { engine, posted } = makeEngine(store);
    engine.detach("agent-1");
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-unbound", name: "Bash", input: { command: "ls" } }),
    );
    assert.equal(posted.length, 0, "no context: no prompt, no decision");
  });
});

// --- two-authority-check (the approval exit) --------------------------------

describe("two-authority-check (approval exit)", () => {
  it("lets the initiator with the class privilege answer", async () => {
    const { engine } = makeEngine(store);
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-a", name: "Bash", input: { command: "ls -la" } }),
    );
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-a",
    });
    assert.equal(check.answered, true, "the initiator's answer is honored");
    assert.equal(check.allowed, true);
  });

  it("refuses a responder who lacks the class privilege", async () => {
    const { engine } = makeEngine(store);
    // `Config` classifies to `config` → require, NOT initiator-only, so the
    // class-privilege check (not the initiator lock) is what refuses here.
    await engine.handlePermissionRequest("agent-1", requestOf({ id: "req-b", name: "ConfigEdit" }));
    const check = await engine.answerFromChannel("agent-1", BYSTANDER, {
      decision: "allow",
      requestId: "req-b",
    });
    assert.equal(check.answered, false, "no class privilege: the answer is inert");
    assert.equal(check.allowed, false);
    assert.equal(check.reason, "class-not-approved");
  });

  it("refuses a non-initiator when the rule is initiator-only", async () => {
    const { engine } = makeEngine(store);
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-c", name: "Bash", input: { command: "ls -la" } }),
    );
    // U0BOB has the class privilege but is not the thread's initiator.
    const check = await engine.answerFromChannel("agent-1", APPROVER, {
      decision: "allow",
      requestId: "req-c",
    });
    assert.equal(check.answered, false, "initiator-only: a non-initiator is refused");
    assert.equal(check.reason, "not-initiator");
  });

  it("ignores an unknown request id (no prompt to answer)", async () => {
    const { engine } = makeEngine(store);
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-none",
    });
    assert.equal(check.answered, false);
  });
});

// --- posture (S10) ---------------------------------------------------------

describe("assertChannelPosture (S10)", () => {
  it("passes a route that keeps at least one class approval-required", () => {
    // The default route auto-allows only `file`; the posture holds.
    assert.doesNotThrow(() => assertChannelPosture([makeAccount(makeRoute())]));
  });

  it("throws ApprovalPostureError when a route auto-allows every class", () => {
    const lax: CompiledRoute = {
      ...makeRoute(),
      approval: [{ match: "*", mode: "auto-allow" }],
    };
    assert.throws(
      () => assertChannelPosture([makeAccount(lax)]),
      (error: unknown) => error instanceof ApprovalPostureError,
      "a `*` auto-allow lifts the posture",
    );
  });
});

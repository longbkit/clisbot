// COMPAT(clisbot-channels): targeted tests for the approval engine (plan §4-S6)
// — the P0 TEXT-MODE scenarios. The native-card half (E1 gating, the question
// prompts E5, the exactly-once race) lives in `approvals-cards.test.ts`; both
// files share the harness + fixtures in `harness.ts` (one definition).
// Drives the real ChannelStore (embedded PGlite) against a fake in-memory
// DaemonConnection: a `permission_requested` on the shared stream path classifies
// the tool class, auto-responds on the daemon for auto-allow / auto-deny, and
// posts an in-thread prompt otherwise. A prompt's answer is re-authorized at the
// approval exit (the SECOND authority check): an approver without the class
// privilege is inert, `initiatorOnly` locks the answer to the thread's initiator,
// and the S10 posture (no route auto-allows every class) is asserted at start.
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { ChannelStore } from "../../db/channels.js";
import {
  assertChannelPosture,
  decidedPromptText,
  parseApprovalCommand,
  promptText,
} from "./index.js";
import { ApprovalPostureError } from "../policy.js";
import {
  APPROVER,
  BYSTANDER,
  INITIATOR,
  makeAccount,
  makeEngine,
  makeRoute,
  openStore,
  requestOf,
  type StoreHandle,
} from "./harness.js";
import type { CompiledRoute } from "../config/compile.js";

// --- Store lifecycle ---------------------------------------------------------

let store: ChannelStore;
let handle: StoreHandle;

beforeAll(async () => {
  handle = await openStore();
  store = handle.store;
}, 60_000);

afterAll(async () => {
  await handle.close();
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
  it("parses a bare verb as the 'latest' target", () => {
    assert.deepEqual(parseApprovalCommand("approve"), { decision: "allow" });
    assert.deepEqual(parseApprovalCommand("/deny"), { decision: "deny" });
    assert.deepEqual(parseApprovalCommand("\\approve"), { decision: "allow" });
  });
  it("rejects anything that is not a command", () => {
    assert.equal(parseApprovalCommand("please approve"), null);
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
    assert.match(posted[0] ?? "", /\/approve/u);
    assert.match(posted[0] ?? "", /\/deny/u);
    assert.match(posted[0] ?? "", /approve req-cmd/u);
  });

  it("marks the prompt initiator-only in its text", () => {
    const text = promptText(requestOf({ id: "req-cmd", name: "Bash" }), true);
    assert.match(text, /Only the person who started this thread can answer\./u);
  });

  it("renders CodexBash commands with a friendly label, cwd, and fencing", () => {
    const request = requestOf({
      id: "permission-exec-b5eb3971-1234-4abc-8def-123456789abc",
      name: "CodexBash",
      input: { command: "printf 'one\\ntwo'\nls -la", cwd: "/workspace/project" },
    });
    const text = promptText(request, true);
    assert.match(text, /\*\*Bash\*\* wants to run/u);
    assert.match(text, /```[\s\S]*printf 'one\\ntwo'[\s\S]*```/u);
    assert.match(text, /in \/workspace\/project/u);
    assert.doesNotMatch(text, /permission-exec-b5eb3971/u);
  });

  it("keeps decided text friendly and free of raw identities and full ids", () => {
    const request = requestOf({
      id: "permission-exec-b5eb3971-1234-4abc-8def-123456789abc",
      name: "CodexBash",
      input: { command: "git status" },
    });
    const text = decidedPromptText({
      request,
      questions: undefined,
      decision: "allow",
      responder: "telegram:123",
    });
    assert.equal(text, "✅ Approved Bash `git status`.");
    assert.doesNotMatch(text, /permission-exec-|telegram:123|[0-9a-f]{8}-[0-9a-f]{4}/iu);
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
    assert.equal(
      check.reason,
      "prompt-not-open",
      "not a privilege verdict — the prompt is not open",
    );
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

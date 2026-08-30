// COMPAT(clisbot-control-plane): the NATIVE-CARD half of the approval engine's
// targeted tests (2026-08-27 slice): the E1 `inlineButtons` gating (card post +
// in-place update + surface gate), the E5 question prompts (AskUserQuestion
// render + `updatedInput.answers` keyed by the full question text), and the
// exactly-once answer-path race (card click vs typed command vs a Paseo client
// answer). The P0 text-mode scenarios live in `approvals.test.ts`; both files
// share the harness + fixtures in `harness.ts` (one definition).
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { ChannelStore } from "../../db/channels.js";
import { ManualClock } from "../plane/clock.js";
import {
  APPROVER,
  INITIATOR,
  makeEngine,
  makeRoute,
  openStore,
  questionRequestOf,
  questionRoute,
  requestOf,
  type StoreHandle,
} from "./harness.js";
import type { AgentPermissionRequest } from "../daemon/types.js";

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

// A two-question AskUserQuestion prompt (the `q<i>` targeting form).
function multiQuestionRequestOf(): AgentPermissionRequest {
  return {
    id: "req-q2",
    provider: "codex",
    name: "AskUserQuestion",
    kind: "question",
    input: {
      questions: [
        {
          question: "Which formatter should the repo use?",
          options: ["Biome", "Prettier"],
          allowOther: true,
        },
        {
          question: "Which line width?",
          options: ["100", "120"],
          allowOther: true,
        },
      ],
    },
  };
}

// --- question prompts (E5: AskUserQuestion) ---------------------------------

describe("question prompts (E5)", () => {
  it("renders the question text + EVERY option + Other, not the tool-permission wording", async () => {
    const { engine, posted } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    assert.equal(posted.length, 1);
    const text = posted[0] ?? "";
    assert.match(text, /Which formatter should the repo use\?/u);
    assert.match(text, /1\. \*\*Biome\*\* — the repo default/u);
    assert.match(text, /2\. \*\*Prettier\*\*/u);
    assert.match(text, /3\. \*\*Other\*\* \(type your own answer\)/u);
    assert.match(text, /approve req-q <option>/u);
    assert.doesNotMatch(text, /asking for permission to use/u);
  });

  it("answers with an option label → updatedInput.answers keyed by the FULL question text", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q",
      answer: "biome", // case-insensitive match; the canonical label goes to the daemon
    });
    assert.equal(check.answered, true);
    assert.equal(responses.length, 1);
    const response = responses[0]?.response;
    assert.deepEqual(response, {
      behavior: "allow",
      updatedInput: { answers: { "Which formatter should the repo use?": "Biome" } },
    });
  });

  it("answers 'Other <free text>' with the free text", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q",
      answer: "Other use the oxfmt preset instead",
    });
    assert.equal(check.answered, true);
    assert.deepEqual(responses[0]?.response, {
      behavior: "allow",
      updatedInput: {
        answers: { "Which formatter should the repo use?": "use the oxfmt preset instead" },
      },
    });
  });

  it("Dismiss (deny) resolves the question prompt with a deny", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "deny",
      requestId: "req-q",
    });
    assert.equal(check.answered, true);
    assert.deepEqual(responses[0]?.response, {
      behavior: "deny",
      message: "denied in the channel thread",
    });
  });

  it("a bare approve (no actionable answer) is inert; the prompt stays open", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    const bare = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q",
    });
    assert.equal(bare.answered, false, "no answer: nothing is dispatched");
    assert.equal(responses.length, 0);
    // The prompt is still open: a real answer afterwards is honored.
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q",
      answer: "Prettier",
    });
    assert.equal(check.answered, true);
    assert.equal(responses.length, 1);
  });

  it("a racing second answer is an inert no-op (exactly once)", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    // Card click and typed command for the SAME question prompt, same instant.
    const [first, second] = await Promise.all([
      engine.answerFromChannel("agent-1", INITIATOR, {
        decision: "allow",
        requestId: "req-q",
        answer: "Biome",
      }),
      engine.answerFromChannel("agent-1", APPROVER, {
        decision: "allow",
        requestId: "req-q",
        answer: "Prettier",
      }),
    ]);
    assert.equal(first.answered, true);
    assert.equal(second.answered, false, "the second answer is inert");
    assert.equal(second.stale, true);
    assert.equal(responses.length, 1, "exactly one daemon response frame");
  });
});

// --- multi-question targeting (`q<i>` prefix) --------------------------------

describe("multi-question AskUserQuestion (q<i> targeting)", () => {
  it("tells the user a bare answer targets question 1, and how to target question 2", async () => {
    const { engine, posted } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", multiQuestionRequestOf());
    const text = posted[0] ?? "";
    assert.match(text, /Which line width\?/u, "both questions render");
    assert.match(
      text,
      /prefix the answer with `q<i>` \(1-based\) to target question <i>/u,
      "the prompt carries the targeting line",
    );
    assert.match(text, /`q1` is the default/u);
  });

  it("a bare answer targets question 1; `q2 <option>` targets question 2", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", multiQuestionRequestOf());
    const first = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q2",
      answer: "Biome",
    });
    assert.equal(first.answered, true);
    assert.deepEqual(responses[0]?.response, {
      behavior: "allow",
      updatedInput: { answers: { "Which formatter should the repo use?": "Biome" } },
    });
    // P0 limit: ONE answer resolves the whole prompt (exactly once) — the
    // other question is answered by the agent re-asking or continuing
    // unanswered; multi-question prompts are single-answer at P0. Assert the
    // TARGETING itself on a fresh prompt.
    const fresh = makeEngine(store, new ManualClock(), questionRoute());
    await fresh.engine.handlePermissionRequest("agent-1", multiQuestionRequestOf());
    const second = await fresh.engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q2",
      answer: "q2 120",
    });
    assert.equal(second.answered, true, "q2 targets the second question");
    assert.deepEqual(fresh.responses[0]?.response, {
      behavior: "allow",
      updatedInput: { answers: { "Which line width?": "120" } },
    });
  });

  it("an out-of-range target is inert (the prompt stays open)", async () => {
    const { engine, responses } = makeEngine(store, new ManualClock(), questionRoute());
    await engine.handlePermissionRequest("agent-1", multiQuestionRequestOf());
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-q2",
      answer: "q9 120",
    });
    assert.equal(check.answered, false, "no such question: nothing is dispatched");
    assert.equal(responses.length, 0);
  });
});

// --- exactly-once resolver (the answer-path race) ----------------------------

describe("exactly-once resolver (race)", () => {
  it("fires agent_permission_response exactly once when two paths race", async () => {
    const { engine, responses } = makeEngine(store);
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-race", name: "Bash", input: { command: "ls -la" } }),
    );
    // A card click and the typed command land at the same instant (both are
    // `answerFromChannel` at the engine level; the facade parses each first).
    const [viaCard, viaTyped] = await Promise.all([
      engine.answerFromChannel("agent-1", INITIATOR, {
        decision: "allow",
        requestId: "req-race",
      }),
      engine.answerFromChannel("agent-1", APPROVER, {
        decision: "deny",
        requestId: "req-race",
      }),
    ]);
    const answered = [viaCard, viaTyped].filter((c) => c.answered).length;
    assert.equal(answered, 1, "exactly one path wins the race");
    assert.equal(responses.length, 1, "exactly one agent_permission_response frame");
    assert.equal(responses[0]?.response.behavior, "allow", "the first path's decision stands");
  });

  it("a client answer (permission_resolved) pre-empts a racing channel answer", async () => {
    const { engine, responses } = makeEngine(store);
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-client", name: "Bash", input: { command: "ls -la" } }),
    );
    // The paired Paseo client answered: the wire reports the resolution.
    engine.onPermissionResolved("agent-1", "req-client");
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-client",
    });
    assert.equal(check.answered, false, "the channel-side answer is inert");
    assert.equal(responses.length, 0, "the hub posts no duplicate daemon frame");
  });
});

// --- native card gating (E1: transport.inlineButtons) ------------------------

describe("native card gating (inlineButtons)", () => {
  it("posts text + command only when the gate is off (the default)", async () => {
    const { engine, postCalls } = makeEngine(store);
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-off", name: "Bash", input: { command: "ls -la" } }),
    );
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0]?.blocks, undefined, "off: no card blocks");
    assert.match(postCalls[0]?.text ?? "", /approve req-off/u);
  });

  it("posts the Block Kit card on a group surface when the gate is `all`", async () => {
    const { engine, postCalls, updateCalls, responses } = makeEngine(
      store,
      new ManualClock(),
      makeRoute(),
      {
        inlineButtons: "all",
      },
    );
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-card", name: "Bash", input: { command: "ls -la" } }),
    );
    const post = postCalls[0];
    assert.ok(post?.blocks !== undefined, "all + group: the card blocks are posted");
    assert.match(
      post?.text ?? "",
      /approve req-card/u,
      "the prompt text still carries the command id",
    );
    const section = post?.blocks?.[0];
    assert.equal(section?.["type"], "section");
    const actions = post?.blocks?.[1];
    assert.equal(actions?.["type"], "actions");
    const buttons = (actions?.["elements"] ?? []) as Record<string, unknown>[];
    assert.deepEqual(
      buttons.map((b) => [b["action_id"], b["value"]]),
      [
        ["approval_action_1", "allow:req-card"],
        ["approval_action_2", "deny:req-card"],
      ],
    );
    // Slack rejects a block whose elements share an `action_id` — the ids
    // must stay unique per button (live: invalid_blocks on a shared id).
    assert.equal(
      new Set(buttons.map((b) => b["action_id"])).size,
      buttons.length,
      "each button carries a unique action_id",
    );
    // The resolution updates the card IN PLACE (one post, one update).
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-card",
    });
    assert.equal(check.answered, true);
    assert.equal(postCalls.length, 1, "the outcome does NOT re-post");
    assert.equal(updateCalls.length, 1, "the decided state lands via the update path");
    assert.match(updateCalls[0]?.text ?? "", /Approved Bash/u);
    assert.doesNotMatch(
      updateCalls[0]?.text ?? "",
      /req-card/u,
      "the decided one-liner carries no raw id",
    );
    assert.equal(updateCalls[0]?.externalMessageId, "1720000000.000001");
    assert.equal(updateCalls[0]?.clearCard, true, "the stale buttons are stripped");
    assert.equal(responses.length, 1);
  });

  it("honors the `dm`/`group` surface gate", async () => {
    // Gate `group`: card on the group surface (a channel root), not on a DM.
    const groupOnly = makeEngine(store, new ManualClock(), makeRoute(), { inlineButtons: "group" });
    await groupOnly.engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-g1", name: "Bash", input: { command: "ls" } }),
    );
    assert.equal(
      groupOnly.postCalls[0]?.blocks !== undefined,
      true,
      "group gate: the group surface gets the card",
    );
    const groupOnlyDm = makeEngine(store, new ManualClock(), makeRoute(), {
      inlineButtons: "group",
    });
    groupOnlyDm.context.rootKind = "dm"; // the binding's root is a DM
    await groupOnlyDm.engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-g2", name: "Bash", input: { command: "ls" } }),
    );
    assert.equal(
      groupOnlyDm.postCalls[0]?.blocks,
      undefined,
      "group gate: no card on a DM surface",
    );
    // Gate `dm`: the opposite — card on the DM, not on the group surface.
    const dmOnly = makeEngine(store, new ManualClock(), makeRoute(), { inlineButtons: "dm" });
    dmOnly.context.rootKind = "dm";
    await dmOnly.engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-dm1", name: "Bash", input: { command: "ls" } }),
    );
    assert.equal(
      dmOnly.postCalls[0]?.blocks !== undefined,
      true,
      "dm gate: the DM surface gets the card",
    );
    const dmOnlyGroup = makeEngine(store, new ManualClock(), makeRoute(), { inlineButtons: "dm" });
    await dmOnlyGroup.engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-dm2", name: "Bash", input: { command: "ls" } }),
    );
    assert.equal(
      dmOnlyGroup.postCalls[0]?.blocks,
      undefined,
      "dm gate: no card on a group surface",
    );
  });

  it("mints one button per question option + Other + Dismiss for a question card", async () => {
    const { engine, postCalls } = makeEngine(store, new ManualClock(), questionRoute(), {
      inlineButtons: "all",
    });
    await engine.handlePermissionRequest("agent-1", questionRequestOf());
    const actions = postCalls[0]?.blocks?.[1];
    const buttons = ((actions?.["elements"] ?? []) as Record<string, unknown>[]).map((b) => [
      String((b["text"] as Record<string, unknown>)?.["text"]),
      String(b["value"]),
    ]) as [string, string][];
    assert.deepEqual(buttons, [
      ["Biome", "allow:req-q:Biome"],
      ["Prettier", "allow:req-q:Prettier"],
      ["Other…", "allow:req-q:Other"],
      ["Dismiss", "deny:req-q"],
    ]);
  });

  it("skips the in-place update when the prompt was posted text-only", async () => {
    const { engine, updateCalls } = makeEngine(store); // gate off: no card
    await engine.handlePermissionRequest(
      "agent-1",
      requestOf({ id: "req-plain", name: "Bash", input: { command: "ls -la" } }),
    );
    const check = await engine.answerFromChannel("agent-1", INITIATOR, {
      decision: "allow",
      requestId: "req-plain",
    });
    assert.equal(check.answered, true);
    assert.equal(updateCalls.length, 0, "no card posted: nothing to update");
  });
});

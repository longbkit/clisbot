// The Route's `questions:` default: how an agent's question (AskUserQuestion)
// is answered when nobody may be watching. Drives the real ApprovalEngine and
// ChannelStore through the shared harness; the fake daemon records responses.
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { ChannelStore } from "../../db/channels.js";
import type { CompiledRoute } from "../config/compile.js";
import type { QuestionsMode } from "../config/enums.js";
import type { AgentPermissionRequest } from "../daemon/types.js";
import { ManualClock } from "../plane/clock.js";
import {
  BYSTANDER,
  makeEngine,
  openStore,
  questionRequestOf,
  questionRoute,
  type StoreHandle,
} from "./harness.js";
import { AGENT_DECIDES_MESSAGE } from "./question-auto-answer.js";

let store: ChannelStore;
let handle: StoreHandle;

beforeAll(async () => {
  handle = await openStore();
  store = handle.store;
}, 60_000);

afterAll(async () => {
  await handle.close();
});

/** The question route with `questions:` set (or absent) and the `other`
 * class under `otherMode`. */
function routeWith(
  questions: QuestionsMode | undefined,
  otherMode: "auto-allow" | "auto-deny" | "require" = "require",
): CompiledRoute {
  const route = questionRoute();
  return {
    ...route,
    defaults: { ...route.defaults, ...(questions === undefined ? {} : { questions }) },
    approval: route.approval.map((rule) =>
      rule.match === "other" ? { match: "other", mode: otherMode } : rule,
    ),
  };
}

function twoQuestionsOf(): AgentPermissionRequest {
  return questionRequestOf({
    id: "req-q2",
    input: {
      questions: [
        { question: "Which formatter?", options: ["Prettier", "Biome (Recommended)"] },
        { question: "Which line width?", options: [{ label: "100" }, { label: "120" }] },
      ],
    },
  });
}

let nextRequest = 0;

/** Each run gets its own request id: the delivery ledger (one store per file)
 * would treat a repeated id as an already-posted prompt. */
async function run(route: CompiledRoute, request: AgentPermissionRequest) {
  const harness = makeEngine(store, new ManualClock(), route);
  nextRequest += 1;
  await harness.engine.handlePermissionRequest("agent-1", {
    ...request,
    id: `${request.id}-${String(nextRequest)}`,
  });
  return harness;
}

describe("questions: recommended", () => {
  it("answers every question with its recommended option, else its first", async () => {
    const { posted, responses } = await run(routeWith("recommended"), twoQuestionsOf());
    assert.equal(posted.length, 0);
    assert.deepEqual(responses[0]?.response, {
      behavior: "allow",
      updatedInput: {
        answers: { "Which formatter?": "Biome (Recommended)", "Which line width?": "100" },
      },
    });
  });

  it("falls back to agent-decides when a question has no options", async () => {
    const request = questionRequestOf({
      input: { questions: [{ question: "Anything else?", options: [] }] },
    });
    const { responses } = await run(routeWith("recommended"), request);
    assert.deepEqual(responses[0]?.response, { behavior: "deny", message: AGENT_DECIDES_MESSAGE });
  });

  it("answers even when the `other` rule auto-denies", async () => {
    const { responses } = await run(routeWith("recommended", "auto-deny"), questionRequestOf());
    assert.deepEqual(responses[0]?.response, {
      behavior: "allow",
      updatedInput: { answers: { "Which formatter should the repo use?": "Biome" } },
    });
  });
});

describe("questions: agent-decides", () => {
  it("tells the agent to decide and continue", async () => {
    const { posted, responses } = await run(routeWith("agent-decides"), questionRequestOf());
    assert.equal(posted.length, 0);
    assert.deepEqual(responses[0]?.response, { behavior: "deny", message: AGENT_DECIDES_MESSAGE });
  });
});

describe("questions: ask", () => {
  it("posts the question even when the `other` rule auto-allows", async () => {
    const { posted, responses } = await run(routeWith("ask", "auto-allow"), questionRequestOf());
    assert.equal(responses.length, 0);
    assert.match(posted[0] ?? "", /Which formatter should the repo use\?/u);
  });

  it("posts the question even when the `other` rule auto-denies", async () => {
    const { posted, responses } = await run(routeWith("ask", "auto-deny"), questionRequestOf());
    assert.equal(responses.length, 0);
    assert.equal(posted.length, 1);
  });

  it("anyone admitted to the conversation may answer it, whatever the approval rules", async () => {
    // A question is not a permission: no approval.* privilege is needed.
    for (const otherMode of ["auto-deny", "auto-allow", "require"] as const) {
      const request = questionRequestOf({ id: `req-ask-${otherMode}` });
      const { engine, responses } = makeEngine(
        store,
        new ManualClock(),
        routeWith("ask", otherMode),
      );
      await engine.handlePermissionRequest("agent-1", request);
      const answer = { decision: "allow" as const, requestId: request.id, answer: "Biome" };
      const answered = await engine.answerFromChannel("agent-1", BYSTANDER, answer);
      assert.equal(answered.answered, true, otherMode);
      assert.deepEqual(responses[0]?.response, {
        behavior: "allow",
        updatedInput: { answers: { "Which formatter should the repo use?": "Biome" } },
      });
    }
  });
});

describe("questions: absent", () => {
  it("asks in the conversation, even when the `other` rule auto-allows or auto-denies", async () => {
    for (const otherMode of ["auto-allow", "auto-deny"] as const) {
      const { posted, responses } = await run(
        routeWith(undefined, otherMode),
        questionRequestOf({ id: `req-absent-${otherMode}` }),
      );
      assert.equal(responses.length, 0, otherMode);
      assert.equal(posted.length, 1, otherMode);
    }
  });
});

describe("tool requests", () => {
  it("ignore `questions:` and follow the approval rules", async () => {
    const route = routeWith("recommended", "auto-allow");
    const { responses } = await run(route, questionRequestOf({ kind: "tool", name: "Frobnicate" }));
    assert.deepEqual(responses[0]?.response, { behavior: "allow" });
  });
});

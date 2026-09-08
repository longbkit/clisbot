import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CompiledRoute } from "../config/compile.js";
import { resolveSelection, selectionMenu } from "./selection.js";

function route(selectable?: CompiledRoute["selectable"]): CompiledRoute {
  return {
    match: { kind: "channel", ids: [] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: {} as CompiledRoute["defaults"],
    approval: [],
    ...(selectable === undefined ? {} : { selectable }),
  };
}

describe("selection menu", () => {
  it("puts the route's own agent first and never repeats it", () => {
    const menu = selectionMenu(route({ agents: ["reviewer", "worker"], models: [] }));
    assert.deepEqual(menu.agents, ["worker", "reviewer"]);
  });

  it("offers only the route's own agent when nothing was authored", () => {
    assert.deepEqual(selectionMenu(route()).agents, ["worker"]);
    assert.deepEqual(selectionMenu(route()).models, []);
  });
});

describe("resolve selection", () => {
  it("refuses every switch on a route that authored no menu", () => {
    const bare = route();
    assert.deepEqual(resolveSelection("agent", "worker", bare), {
      ok: false,
      message: "This route offers no agent choices.",
    });
    assert.deepEqual(resolveSelection("model", "gpt-5.6-luna", bare), {
      ok: false,
      message: "This route offers no model choices.",
    });
  });

  it("accepts a listed name, case-insensitively, and returns the authored spelling", () => {
    const withMenu = route({ agents: ["reviewer"], models: ["gpt-5.6-luna"] });
    assert.deepEqual(resolveSelection("agent", " ReViEwEr ", withMenu), {
      ok: true,
      kind: "agent",
      value: "reviewer",
    });
    assert.deepEqual(resolveSelection("model", "GPT-5.6-Luna", withMenu), {
      ok: true,
      kind: "model",
      value: "gpt-5.6-luna",
    });
  });

  it("refuses a name outside the menu and lists what is on it", () => {
    const refusal = resolveSelection("model", "gpt-9", route({ agents: [], models: ["a", "b"] }));
    assert.deepEqual(refusal, { ok: false, message: "Unknown model. Options: a, b." });
  });

  it("lets a conversation switch back to the route's own agent", () => {
    const withMenu = route({ agents: ["reviewer"], models: [] });
    assert.deepEqual(resolveSelection("agent", "worker", withMenu), {
      ok: true,
      kind: "agent",
      value: "worker",
    });
  });
});

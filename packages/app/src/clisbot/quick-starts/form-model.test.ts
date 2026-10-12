import { expect, test } from "vitest";
import { openQuickStartForm } from "./form-model";
import type { QuickStartInput } from "@clisbot/protocol/quick-starts/types";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
const input: QuickStartInput = {
  name: "Triage",
  startingPrompt: "Investigate",
  visibility: "personal",
  target: { kind: "quickChat" },
  agent: { kind: "default" },
};
const entries: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    enabled: true,
    status: "ready",
    models: [
      {
        provider: "mock",
        id: "fast",
        label: "Fast",
        thinkingOptions: [{ id: "high", label: "High" }],
      },
    ],
    modes: [{ id: "safe", label: "Safe" }],
  },
];
function form() {
  return openQuickStartForm(
    { id: "qs_0000000000000001", revision: 1, input },
    { label: "Quick chat" },
  );
}
test("catalog refresh preserves typed prompt, selected display and dirty state", () => {
  const model = form();
  model.change({ ...input, startingPrompt: "My unsaved investigation" });
  model.applyProviders(entries);
  expect(model.getState()).toMatchObject({
    input: { startingPrompt: "My unsaved investigation" },
    destinationDisplay: { label: "Quick chat" },
    dirty: true,
    canSave: true,
  });
});
test("configured values are held while providers load, and validated without silent fallback", () => {
  const model = form();
  const configured: QuickStartInput = {
    ...input,
    agent: {
      kind: "configured",
      config: {
        provider: "mock",
        model: "fast",
        thinkingOptionId: "high",
        modeId: "safe",
      },
    },
  };
  model.change(configured);
  expect(model.getState().canSave).toBe(false);
  model.applyProviders(entries);
  expect(model.getState().canSave).toBe(true);
  model.applyProviders([]);
  expect(model.getState().canSave).toBe(false);
  expect(model.getState().input).toEqual(configured);
});
test("conflict preserves draft and blocks blind retry until the user chooses a recovery", () => {
  const model = form();
  model.change({ ...input, startingPrompt: "Local draft" });
  model.setConflict();
  model.change({ ...model.getState().input, name: "Local title" });
  expect(model.getState()).toMatchObject({
    conflict: true,
    canSave: false,
    input: { startingPrompt: "Local draft" },
  });
  const copy = openQuickStartForm(
    { id: "qs_0000000000000002", revision: 0, input: model.getState().input },
    model.getState().destinationDisplay,
  );
  expect(copy.getState()).toMatchObject({ conflict: false, canSave: true });
});
test("named worktree branch must be supplied, and no existing workspace is captured", () => {
  const model = form();
  model.change({
    ...input,
    target: {
      kind: "project",
      projectId: "p1",
      workspace: { kind: "worktree", base: { kind: "ref", refName: "" } },
    },
  });
  expect(model.getState().canSave).toBe(false);
  model.change({
    ...input,
    target: {
      kind: "project",
      projectId: "p1",
      workspace: { kind: "worktree", base: { kind: "ask" } },
    },
  });
  expect(model.getState().canSave).toBe(true);
});
test("a fresh editor does not inherit the previous record's permission or sharing settings", () => {
  const old = form();
  old.change({
    ...input,
    visibility: "host",
    agent: { kind: "configured", config: { provider: "mock", modeId: "safe" } },
  });
  old.close();
  expect(form().getState()).toMatchObject({
    input,
    dirty: false,
    conflict: false,
    canSave: true,
  });
});

test("switching Default and Custom retains the explicit model and permission choices", () => {
  const model = form();
  model.applyProviders(entries);
  model.change({
    ...input,
    agent: {
      kind: "configured",
      config: { provider: "mock", model: "fast", thinkingOptionId: "high", modeId: "safe" },
    },
  });
  const configured = model.getState().input.agent;
  model.setAgentKind("default");
  expect(model.getState().input.agent).toEqual({ kind: "default" });
  model.setAgentKind("configured");
  expect(model.getState().input.agent).toEqual(configured);
  expect(model.getState().canSave).toBe(true);
});

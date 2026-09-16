import { describe, expect, it } from "vitest";
import { accessConstraintDraft, mergeAccessConstraints } from "./access-assignment-edit";

describe("Access assignment constraint editing", () => {
  it("preserves grouped grants and unknown fields when their choices are unchanged", () => {
    const existing = {
      agentConfigurations: [
        {
          providerId: "codex",
          modelIds: ["m1", "m2"],
          thinkingOptionIds: ["low", "high"],
          future: true,
        },
      ],
      futureConstraint: { ceiling: 3 },
    };
    const draft = accessConstraintDraft(existing);
    // One stored grant stays one row; it is not exploded per Model or Thinking.
    expect(draft.agentConfigurations).toHaveLength(1);
    const edited = draft.agentConfigurations.map(({ providerId, modelIds, thinkingOptionIds }) => ({
      providerId,
      modelIds,
      thinkingOptionIds,
    }));
    expect(mergeAccessConstraints(existing, { agentConfigurations: edited })).toEqual(existing);
    expect(existing.agentConfigurations).toHaveLength(1);
  });

  it("changes only the selected constraint and preserves wildcard grants", () => {
    const existing = {
      agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
      futureConstraint: "keep",
    };
    expect(accessConstraintDraft(existing).agentConfigurations).toEqual([
      { providerId: "codex", modelIds: "*", thinkingOptionIds: "*" },
    ]);
    const next = {
      agentConfigurations: [{ providerId: "codex", modelIds: ["m1"], thinkingOptionIds: "*" }],
    };
    expect(mergeAccessConstraints(existing, next)).toEqual({ ...next, futureConstraint: "keep" });
  });

  it("keeps conversation evidence until explicitly changed without retaining stale specific IDs", () => {
    const existing = { conversation: { kind: "specific", conversationIds: ["C1"], future: true } };
    expect(
      mergeAccessConstraints(existing, {
        conversation: { kind: "specific", conversationIds: ["C1"] },
      }),
    ).toEqual(existing);
    expect(mergeAccessConstraints(existing, { conversation: { kind: "direct_messages" } })).toEqual(
      { conversation: { kind: "direct_messages" } },
    );
  });

  it("removes Agent configuration constraints when the new level cannot create Agents", () => {
    expect(
      mergeAccessConstraints(
        {
          agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
          futureConstraint: true,
        },
        {},
      ),
    ).toEqual({ futureConstraint: true });
  });

  it.each([
    { conversation: { kind: "future_scope" } },
    { conversation: { kind: "specific", conversationIds: [] } },
    { agentConfigurations: [{ providerId: "codex", modelIds: [], thinkingOptionIds: "*" }] },
  ])(
    "rejects an unsupported constraint draft instead of silently widening it: %j",
    (constraints) => {
      expect(accessConstraintDraft(constraints).valid).toBe(false);
    },
  );
});

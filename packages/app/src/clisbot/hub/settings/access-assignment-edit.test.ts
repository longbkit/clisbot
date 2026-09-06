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
    expect(draft.agentConfigurations).toHaveLength(4);
    const edited = draft.agentConfigurations.map(({ providerId, modelId, thinkingOptionId }) => ({
      providerId,
      modelIds: [modelId],
      thinkingOptionIds: [thinkingOptionId],
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
      { providerId: "codex", modelId: "*", thinkingOptionId: "*" },
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

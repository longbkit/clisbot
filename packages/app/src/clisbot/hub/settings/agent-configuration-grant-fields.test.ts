import { describe, expect, it, vi } from "vitest";
import { accessConstraintDraft, mergeAccessConstraints } from "./access-assignment-edit";
import {
  agentConfigurationDraftFrom,
  uniqueAgentConfigurationGrants,
} from "./agent-configuration-grant-fields";

// These modules render platform pickers that cannot load under this runner.
vi.mock("./multi-select-field", () => ({
  MultiSelectField: () => null,
  selectionLabel: () => null,
}));
vi.mock("@/components/ui/select-field", () => ({ SelectField: () => null }));

describe("Agent configuration grants", () => {
  it("saves an unchanged stored grant back verbatim, including order and unknown fields", () => {
    const existing = {
      agentConfigurations: [
        {
          providerId: "codex",
          modelIds: ["m2", "m1"],
          thinkingOptionIds: ["low", "high"],
          future: true,
        },
      ],
    };
    // The path the form takes: stored grant → editable rows → grants → merge.
    const rows = accessConstraintDraft(existing).agentConfigurations.map(
      agentConfigurationDraftFrom,
    );
    const next = { agentConfigurations: uniqueAgentConfigurationGrants(rows) };
    expect(mergeAccessConstraints(existing, next)).toEqual(existing);
  });

  it("drops a row that repeats another in a different order", () => {
    const rows = [
      { providerId: "codex", modelIds: ["m1", "m2"], thinkingOptionIds: "*" as const },
      { providerId: "codex", modelIds: ["m2", "m1", "m2"], thinkingOptionIds: "*" as const },
    ].map(agentConfigurationDraftFrom);
    expect(uniqueAgentConfigurationGrants(rows)).toEqual([
      { providerId: "codex", modelIds: ["m1", "m2"], thinkingOptionIds: "*" },
    ]);
  });
});

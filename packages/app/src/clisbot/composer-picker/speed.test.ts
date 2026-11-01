import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import { resolvePanelFeatures, resolveSpeedControl } from "./speed";

function select(
  id: string,
  value: string,
  tiers: Array<[id: string, label: string, isDefault?: boolean]>,
): AgentFeature {
  return {
    type: "select",
    id,
    label: "Speed",
    value,
    options: tiers.map(([tierId, label, isDefault]) => ({
      id: tierId,
      label,
      ...(isDefault ? { isDefault } : {}),
    })),
  };
}

const CLAUDE_FAST: AgentFeature = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  value: false,
};

/** Each option as [key, value written, costs more]; the selected option's key. */
interface SpeedCase {
  name: string;
  feature: AgentFeature;
  options: Array<[key: string, value: unknown, costsMore: boolean]> | null;
  selected?: string | null;
}

const CASES: SpeedCase[] = [
  {
    name: "Claude and OMP fast_mode: Standard | Fast",
    feature: CLAUDE_FAST,
    options: [
      ["standard", false, false],
      ["fast", true, true],
    ],
    selected: "standard",
  },
  {
    name: "Codex service_tier with fast and ultrafast: all three levels",
    feature: select("service_tier", "ultrafast", [
      ["default", "Normal", true],
      ["fast", "Fast"],
      ["ultrafast", "Ultrafast"],
    ]),
    options: [
      ["standard", "default", false],
      ["fast", "fast", true],
      ["ultra", "ultrafast", true],
    ],
    selected: "ultra",
  },
  {
    name: "Codex priority is Fast",
    feature: select("service_tier", "priority", [
      ["default", "Normal", true],
      ["priority", "Priority"],
    ]),
    options: [
      ["standard", "default", false],
      ["fast", "priority", true],
    ],
    selected: "fast",
  },
  {
    name: "Codex with only an ultrafast tier offers no Fast",
    feature: select("service_tier", "default", [
      ["default", "Normal", true],
      ["ultrafast", "Ultrafast"],
    ]),
    options: [
      ["standard", "default", false],
      ["ultra", "ultrafast", true],
    ],
    selected: "standard",
  },
  {
    name: "Codex Flex keeps its own option and is selected as itself",
    feature: select("service_tier", "flex", [
      ["default", "Normal", true],
      ["priority", "Fast"],
      ["flex", "Flex"],
    ]),
    options: [
      ["standard", "default", false],
      ["fast", "priority", true],
      ["tier:flex", "flex", false],
    ],
    selected: "tier:flex",
  },
  {
    name: "Codex with Flex alone still offers it",
    feature: select("service_tier", "default", [
      ["default", "Normal", true],
      ["flex", "Flex"],
    ]),
    options: [
      ["standard", "default", false],
      ["tier:flex", "flex", false],
    ],
    selected: "standard",
  },
  {
    // agent.fast.use gates every tier but the cheap ones, so the panel marks the cost the same way.
    name: "a tier nobody has classified costs more, Auto does not",
    feature: select("service_tier", "default", [
      ["default", "Normal", true],
      ["scale", "Scale"],
      ["auto", "Auto"],
    ]),
    options: [
      ["standard", "default", false],
      ["tier:scale", "scale", true],
      ["tier:auto", "auto", false],
    ],
    selected: "standard",
  },
  {
    name: "Cursor fast select: Standard | Fast",
    feature: select("fast", "true", [
      ["false", "Off"],
      ["true", "On"],
    ]),
    options: [
      ["standard", "false", false],
      ["fast", "true", true],
    ],
    selected: "fast",
  },
  {
    name: "a value the model does not offer selects nothing",
    feature: select("service_tier", "scale", [
      ["default", "Normal", true],
      ["priority", "Fast"],
    ]),
    options: [
      ["standard", "default", false],
      ["fast", "priority", true],
    ],
    selected: null,
  },
  {
    name: "a model with one tier has no control",
    feature: select("service_tier", "default", [["default", "Normal", true]]),
    options: null,
  },
];

describe("Standard | Fast | Ultra fast", () => {
  it.each(CASES)("$name", (entry) => {
    const control = resolveSpeedControl([entry.feature]);
    if (entry.options === null) {
      expect(control).toBeNull();
      return;
    }
    expect(control?.featureId).toBe(entry.feature.id);
    expect(control?.options.map((option) => [option.key, option.value, option.costsMore])).toEqual(
      entry.options,
    );
    expect(control?.selectedKey).toBe(entry.selected);
  });

  it("names a tier outside the levels by its own label", () => {
    const control = resolveSpeedControl([
      select("service_tier", "default", [
        ["default", "Normal", true],
        ["flex", "Flex"],
      ]),
    ]);
    expect(control?.options.at(-1)).toMatchObject({ level: null, label: "Flex" });
  });

  it("is absent without a speed feature", () => {
    expect(resolveSpeedControl([])).toBeNull();
  });
});

describe("panel features", () => {
  const AUTO_ACCEPT: AgentFeature = {
    type: "toggle",
    id: "auto_accept",
    label: "Auto Accept",
    value: false,
  };
  const AGENT: AgentFeature = {
    type: "select",
    id: "agent",
    label: "Agent",
    value: "a",
    options: [{ id: "a", label: "A" }],
  };

  it("keeps speed out of More and hides auto_accept once Full auto-accept exists", () => {
    const panel = resolvePanelFeatures([CLAUDE_FAST, AUTO_ACCEPT, AGENT], {
      fullAutoAcceptSupported: true,
    });
    expect(panel.speed?.featureId).toBe("fast_mode");
    expect(panel.more.map((feature) => feature.id)).toEqual(["agent"]);
  });

  it("keeps auto_accept on a host without Full auto-accept", () => {
    const panel = resolvePanelFeatures([AUTO_ACCEPT], { fullAutoAcceptSupported: false });
    expect(panel.more.map((feature) => feature.id)).toEqual(["auto_accept"]);
  });
});

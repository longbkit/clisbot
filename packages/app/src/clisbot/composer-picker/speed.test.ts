import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import { resolvePanelFeatures, resolveSpeedControl } from "./speed";

const CLAUDE_FAST: AgentFeature = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  value: false,
};

const CODEX_SPEED: AgentFeature = {
  type: "select",
  id: "service_tier",
  label: "Speed",
  value: "default",
  options: [
    { id: "default", label: "Normal", isDefault: true },
    { id: "fast", label: "Fast" },
    { id: "ultrafast", label: "Ultrafast" },
  ],
};

const CURSOR_FAST: AgentFeature = {
  type: "select",
  id: "fast",
  label: "Fast",
  value: "true",
  options: [
    { id: "false", label: "Off" },
    { id: "true", label: "On" },
  ],
};

describe("Standard | Fast", () => {
  it("maps Claude's fast_mode toggle", () => {
    expect(resolveSpeedControl([CLAUDE_FAST])).toEqual({
      featureId: "fast_mode",
      selected: "standard",
      values: { standard: false, fast: true },
    });
  });

  it("maps Codex's service tiers, Fast picking the fastest", () => {
    expect(resolveSpeedControl([CODEX_SPEED])).toEqual({
      featureId: "service_tier",
      selected: "standard",
      values: { standard: "default", fast: "ultrafast" },
    });
  });

  it("maps Cursor's fast select", () => {
    expect(resolveSpeedControl([CURSOR_FAST])).toMatchObject({
      featureId: "fast",
      selected: "fast",
      values: { standard: "false", fast: "true" },
    });
  });

  it("is absent when the model has no faster tier", () => {
    expect(resolveSpeedControl([])).toBeNull();
    const flexOnly: AgentFeature = {
      ...CODEX_SPEED,
      options: [
        { id: "default", label: "Normal", isDefault: true },
        { id: "flex", label: "Flex" },
      ],
    };
    expect(resolveSpeedControl([flexOnly])).toBeNull();
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

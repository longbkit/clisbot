import { describe, expect, test } from "vitest";
import { isFasterTier, usesFasterTier } from "./speed-tier.js";

describe("isFasterTier", () => {
  // One row per tier a provider sells today, plus the values nobody has classified yet.
  test.each([
    // Claude, OMP: the fast_mode toggle.
    ["fast_mode", true, true],
    ["fast_mode", false, false],
    ["fast_mode", undefined, false],
    // Codex: the service_tier select. Only the cheap tiers pass without agent.fast.use.
    ["service_tier", "default", false],
    ["service_tier", "standard", false],
    ["service_tier", "flex", false],
    ["service_tier", "Flex", false],
    ["service_tier", "auto", false],
    ["service_tier", null, false],
    ["service_tier", "fast", true],
    ["service_tier", "priority", true],
    ["service_tier", "ultrafast", true],
    ["service_tier", "scale", true],
    ["service_tier", "express", true],
    ["service_tier", 1, true],
    // Cursor: the fast select, sent as a string.
    ["fast", "true", true],
    ["fast", true, true],
    ["fast", "false", false],
    ["fast", false, false],
    // Not a speed feature.
    ["thought_level", "high", false],
  ])("%s = %j is faster: %s", (featureId, value, faster) => {
    expect(isFasterTier(featureId, value)).toBe(faster);
  });

  test("a configuration uses a faster tier when any of its features does", () => {
    expect(usesFasterTier({ service_tier: "flex", fast_mode: false })).toBe(false);
    expect(usesFasterTier({ service_tier: "turbo-plus" })).toBe(true);
    expect(usesFasterTier(undefined)).toBe(false);
  });
});

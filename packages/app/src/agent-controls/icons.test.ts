import { Settings2, Shield, ShieldCheck, Zap } from "lucide-react-native";
import { describe, expect, it } from "vitest";
import { getAgentFeatureIcon, getAgentFeatureToggleIcon } from "./icons";

describe("getAgentFeatureToggleIcon", () => {
  it("uses an empty shield when auto-accept is off and a check when it is on", () => {
    expect(getAgentFeatureToggleIcon("shield-check", false)).toBe(Shield);
    expect(getAgentFeatureToggleIcon("shield-check", true)).toBe(ShieldCheck);
  });

  it("leaves unrelated feature icons unchanged", () => {
    expect(getAgentFeatureToggleIcon("zap", false)).toBe(Zap);
    expect(getAgentFeatureToggleIcon("zap", true)).toBe(getAgentFeatureIcon("zap"));
  });
});

describe("getAgentFeatureIcon", () => {
  it("draws the Lucide icon a plugin provider names", () => {
    const icon = getAgentFeatureIcon("Mic");
    expect(icon).not.toBe(Settings2);
    expect(getAgentFeatureIcon("Mic")).toBe(icon);
  });

  it("falls back to the generic icon for a missing or unknown name", () => {
    expect(getAgentFeatureIcon()).toBe(Settings2);
    expect(getAgentFeatureIcon("not-an-icon")).toBe(Settings2);
  });
});

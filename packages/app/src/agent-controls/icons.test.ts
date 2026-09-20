import { describe, expect, it } from "vitest";
import { Shield, ShieldCheck, Zap } from "lucide-react-native";
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

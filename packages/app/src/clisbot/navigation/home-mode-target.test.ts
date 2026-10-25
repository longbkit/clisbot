import { describe, expect, it } from "vitest";
import { modeTargetChange } from "./home-mode-target";

describe("modeTargetChange", () => {
  it("moves Chat mode to the last Bot and Work mode back to its last start", () => {
    expect(modeTargetChange("chat", "project", { bot: "nia" })).toEqual({
      kind: "bot",
      botId: "nia",
    });
    expect(modeTargetChange("work", "bot", { work: "quickChat" })).toEqual({ kind: "quickChat" });
    expect(modeTargetChange("work", "bot", {})).toEqual({ kind: "project" });
  });

  it("leaves a target that already fits the mode, and Hybrid, alone", () => {
    expect(modeTargetChange("chat", "bot", {})).toBeNull();
    expect(modeTargetChange("work", "quickChat", {})).toBeNull();
    expect(modeTargetChange("hybrid", "bot", {})).toBeNull();
  });
});

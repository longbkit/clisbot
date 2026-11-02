import { describe, expect, it } from "vitest";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { applyForkModelChoice } from "./feature";

const claudeSetup: WorkspaceDraftTabSetup = {
  provider: "claude",
  cwd: "/repo",
  modeId: "acceptEdits",
  model: "opus",
  thinkingOptionId: "xhigh",
  featureValues: { fast: true },
};

describe("applyForkModelChoice", () => {
  it("keeps the source setup when no model was chosen", () => {
    expect(applyForkModelChoice(claudeSetup, undefined)).toBe(claudeSetup);
  });

  it("switches provider and drops the source provider's mode, effort and features", () => {
    expect(
      applyForkModelChoice(claudeSetup, { provider: "codex", modelId: "gpt-6.1-terra" }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: null,
      model: "gpt-6.1-terra",
      thinkingOptionId: null,
      featureValues: {},
    });
  });

  it("keeps the mode and features for another model of the same provider", () => {
    expect(applyForkModelChoice(claudeSetup, { provider: "claude", modelId: "sonnet" })).toEqual({
      ...claudeSetup,
      model: "sonnet",
      thinkingOptionId: null,
    });
  });
});

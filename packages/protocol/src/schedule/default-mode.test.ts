import { describe, expect, test } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "../provider-manifest.js";
import { resolveScheduleDefaultModeId } from "./default-mode.js";

function manifest(provider: string) {
  const definition = AGENT_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider);
  if (!definition) throw new Error(`No ${provider}`);
  return definition;
}

describe("resolveScheduleDefaultModeId", () => {
  // Every built-in provider's manifest: the default when it asks, else the first mode that asks.
  test.each([
    ["claude", "auto"],
    ["codex", "auto-review"],
    ["copilot", "https://agentclientprotocol.com/protocol/session-modes#agent"],
    ["opencode", "build"],
    ["omp", "write"],
    ["pi", undefined],
  ])("%s runs in %s", (provider, expected) => {
    const { modes, defaultModeId } = manifest(provider);
    expect(resolveScheduleDefaultModeId(modes, defaultModeId)).toBe(expected);
  });

  test("never Plan, never a no-prompt mode", () => {
    const modes = [{ id: "plan" }, { id: "yolo", isUnattended: true }, { id: "ask" }];
    expect(resolveScheduleDefaultModeId(modes, "yolo")).toBe("ask");
    expect(resolveScheduleDefaultModeId(modes, null)).toBe("ask");
  });

  test("a provider whose only mode runs without prompts gets none", () => {
    expect(resolveScheduleDefaultModeId([{ id: "full", isUnattended: true }], "full")).toBe(
      undefined,
    );
  });
});

import { describe, expect, test } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "@clisbot/protocol/provider-manifest";
import type { AgentMode, AgentStreamEvent } from "./agent-sdk-types.js";
import { normalizeProviderModes, normalizeProviderModesEvent } from "./provider-modes.js";

function manifestModes(provider: string) {
  return AGENT_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider)?.modes ?? [];
}

function unattendedIds(modes: AgentMode[]): string[] {
  return modes.filter((mode) => mode.isUnattended).map((mode) => mode.id);
}

describe("provider modes at the daemon boundary", () => {
  // A provider reports bare runtime modes; the manifest owns icons, tiers and which mode
  // runs without prompts. One table, one row per built-in provider.
  test.each([
    [
      "claude",
      ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
      ["bypassPermissions"],
    ],
    ["codex", ["plan", "auto", "auto-review", "full-access"], ["full-access"]],
    [
      "copilot",
      ["https://agentclientprotocol.com/protocol/session-modes#agent", "allow-all"],
      ["allow-all"],
    ],
    ["opencode", ["build", "plan"], []],
    ["omp", ["full", "write", "ask"], ["full"]],
    ["pi", [], []],
  ])("%s: runtime modes gain the manifest's no-prompt mark", (provider, ids, unattended) => {
    const runtime = ids.map((id) => ({ id, label: id }));
    const modes = normalizeProviderModes(runtime, manifestModes(provider));
    expect(modes.map((mode) => mode.id)).toEqual(ids);
    expect(unattendedIds(modes)).toEqual(unattended);
    for (const mode of modes) {
      if (manifestModes(provider).some((entry) => entry.id === mode.id)) {
        expect(mode.colorTier).toBeDefined();
      }
    }
  });

  test("a mode the manifest does not know (generic ACP, OpenCode agents) stays as reported", () => {
    const runtime = [{ id: "kiro-yolo", label: "YOLO", colorTier: "dangerous" }];
    expect(normalizeProviderModes(runtime, [])).toEqual(runtime);
  });

  test("a provider's own metadata wins over the manifest", () => {
    const runtime = [{ id: "full-access", label: "Full", isUnattended: false }];
    expect(normalizeProviderModes(runtime, manifestModes("codex"))[0]?.isUnattended).toBe(false);
  });

  test("mode_changed carries normalized modes too", () => {
    const event: AgentStreamEvent = {
      type: "mode_changed",
      provider: "codex",
      currentModeId: "auto",
      availableModes: [{ id: "full-access", label: "Full Access" }],
    };
    const normalized = normalizeProviderModesEvent(event, manifestModes("codex"));
    expect(normalized.type === "mode_changed" && unattendedIds(normalized.availableModes)).toEqual([
      "full-access",
    ]);
  });
});

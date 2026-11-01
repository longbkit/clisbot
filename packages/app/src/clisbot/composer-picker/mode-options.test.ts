import { describe, expect, it } from "vitest";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import {
  buildComposerModeOptions,
  resolveComposerModeId,
  resolveModeConcept,
  resolveModeLabelKey,
} from "./mode-options";

const CLAUDE: AgentMode[] = [
  { id: "plan", label: "Plan Mode", colorTier: "planning" },
  { id: "default", label: "Always Ask", colorTier: "safe" },
  { id: "acceptEdits", label: "Accept File Edits", colorTier: "moderate" },
  { id: "auto", label: "Auto mode", colorTier: "moderate" },
  { id: "bypassPermissions", label: "Bypass", colorTier: "dangerous" },
];

describe("composer mode list", () => {
  it("ends with Full auto-accept when the host offers it", () => {
    const ids = buildComposerModeOptions(CLAUDE, true).map((mode) => mode.id);
    expect(ids.at(-1)).toBe(FULL_AUTO_ACCEPT_MODE_ID);
    expect(ids).toHaveLength(CLAUDE.length + 1);
  });

  it("keeps the provider's own list on an older host", () => {
    expect(buildComposerModeOptions(CLAUDE, false)).toEqual(CLAUDE);
    expect(buildComposerModeOptions([], true)).toEqual([]);
  });

  it("shows Full auto-accept as the current mode while it is on", () => {
    expect(resolveComposerModeId("bypassPermissions", true)).toBe(FULL_AUTO_ACCEPT_MODE_ID);
    expect(resolveComposerModeId("default", false)).toBe("default");
  });
});

describe("mode concepts", () => {
  it("reads Claude's modes", () => {
    expect(CLAUDE.map((mode) => resolveModeConcept("claude", mode))).toEqual([
      "plan",
      "ask",
      "acceptEdits",
      "auto",
      "bypass",
    ]);
  });

  it("reads Codex's modes, Plan included", () => {
    const codex: AgentMode[] = [
      { id: "plan", label: "Plan" },
      { id: "auto", label: "Default Permissions" },
      { id: "auto-review", label: "Auto-review" },
      { id: "full-access", label: "Full Access" },
    ];
    expect(codex.map((mode) => resolveModeConcept("codex", mode))).toEqual([
      "plan",
      "ask",
      "auto",
      "bypass",
    ]);
  });

  it("falls back on colour tier for an unknown provider", () => {
    expect(resolveModeConcept("acme", { id: "x", label: "X", colorTier: "planning" })).toBe("plan");
    expect(resolveModeConcept("acme", { id: "y", label: "Y", colorTier: "dangerous" })).toBe(
      "bypass",
    );
    expect(resolveModeConcept("acme", { id: "z", label: "Z" })).toBe("ask");
    expect(
      resolveModeConcept("acme", { id: FULL_AUTO_ACCEPT_MODE_ID, label: "Full auto-accept" }),
    ).toBe("fullAutoAccept");
  });

  it("names known modes in the app's language and leaves unknown ones to the daemon", () => {
    expect(resolveModeLabelKey("claude", "acceptEdits")).toBe("claudeAcceptEdits");
    expect(resolveModeLabelKey("codex", "auto")).toBe("codexDefault");
    expect(resolveModeLabelKey("opencode", "plan")).toBe("plan");
    expect(resolveModeLabelKey("acme", "x")).toBeNull();
  });
});

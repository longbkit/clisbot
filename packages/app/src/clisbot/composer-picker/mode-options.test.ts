import { describe, expect, it } from "vitest";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import {
  buildComposerModeOptions,
  isProviderAutoAcceptOn,
  resolveComposerModeId,
  resolveModeConcept,
  shouldClearProviderAutoAccept,
  resolveModeLabelKey,
  resolveModeProvider,
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

  // A newer Host hides the provider's own auto_accept toggle; a session can still have it on
  // (an unattended create, a schedule, an older app), so the composer shows it as what it is.
  it("shows a provider's own auto_accept as Full auto-accept", () => {
    const features = [{ type: "toggle" as const, id: "auto_accept", label: "Auto", value: true }];
    expect(isProviderAutoAcceptOn(features)).toBe(true);
    expect(isProviderAutoAcceptOn([{ ...features[0], value: false }])).toBe(false);
    expect(resolveComposerModeId("ask", false, true)).toBe(FULL_AUTO_ACCEPT_MODE_ID);
  });

  it("clears the provider's auto_accept when another mode is picked", () => {
    expect(shouldClearProviderAutoAccept("ask", true)).toBe(true);
    expect(shouldClearProviderAutoAccept(FULL_AUTO_ACCEPT_MODE_ID, true)).toBe(false);
    expect(shouldClearProviderAutoAccept("ask", false)).toBe(false);
  });
});

describe("custom providers", () => {
  const definitions = [
    { id: "zai-claude", baseProvider: "claude" },
    { id: "qwen-codex", baseProvider: "codex" },
    { id: "grok" },
  ];

  it("name and draw an extended built-in's modes as the built-in's", () => {
    const zai = resolveModeProvider("zai-claude", definitions);
    expect(resolveModeLabelKey(zai, "bypassPermissions")).toBe("claudeBypass");
    expect(resolveModeConcept(zai, { id: "acceptEdits", label: "Accept File Edits" })).toBe(
      "acceptEdits",
    );
    const qwen = resolveModeProvider("qwen-codex", definitions);
    expect(resolveModeLabelKey(qwen, "full-access")).toBe("codexFullAccess");
    expect(resolveModeConcept(qwen, { id: "auto", label: "Default" })).toBe("ask");
  });

  it("an ACP custom provider keeps the daemon's labels", () => {
    const grok = resolveModeProvider("grok", definitions);
    expect(grok).toBe("grok");
    expect(resolveModeLabelKey(grok, "default")).toBeNull();
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

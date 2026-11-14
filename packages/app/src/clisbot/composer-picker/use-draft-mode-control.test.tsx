// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import { resolveEffectiveComposerModeId } from "@/provider-selection/provider-selection";
import { useSessionStore } from "@/stores/session-store";
import { useDraftOfferedModes } from "./use-draft-mode-control";

const CLAUDE_MODES: AgentMode[] = [
  { id: "plan", label: "Plan" },
  { id: "default", label: "Default" },
  { id: "acceptEdits", label: "Accept edits" },
  { id: "bypassPermissions", label: "Bypass permissions" },
];

function setHostFeatures(features: Record<string, boolean>): void {
  useSessionStore.setState({ sessions: { srv: { serverInfo: { features } } } } as never);
}

function submittedMode(modeId: string): string {
  const { result } = renderHook(() => useDraftOfferedModes("srv", CLAUDE_MODES));
  return resolveEffectiveComposerModeId(
    {
      provider: "claude",
      modelId: "claude-opus-5-5",
      modeId,
      thinkingOptionId: "high",
      availableModels: [],
      modeOptions: result.current,
    },
    false,
  );
}

describe("useDraftOfferedModes", () => {
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ sessions: {} } as never);
  });

  it("creates a draft in Full auto-accept instead of the provider's first mode", () => {
    setHostFeatures({ fullAutoAccept: true });
    expect(submittedMode(FULL_AUTO_ACCEPT_MODE_ID)).toBe(FULL_AUTO_ACCEPT_MODE_ID);
  });

  it("keeps a provider mode the user picked", () => {
    setHostFeatures({ fullAutoAccept: true });
    expect(submittedMode("acceptEdits")).toBe("acceptEdits");
  });

  it("falls back to the first offered mode on a Host without Full auto-accept", () => {
    setHostFeatures({});
    expect(submittedMode(FULL_AUTO_ACCEPT_MODE_ID)).toBe("plan");
  });
});

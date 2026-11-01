import { describe, expect, test } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "@clisbot/protocol/provider-manifest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { normalizeProviderModes } from "./provider-modes.js";
import { buildProviderRegistry } from "./provider-registry.js";

/**
 * PINNED, NOT DECIDED (review B-1 on PR #46). A schedule with no mode runs its agent as an
 * unattended create (`schedule/service.ts`: `mode: config.modeId`, `unattended: true`). Since
 * `normalizeProviderModes` copies the manifest's `isUnattended` onto runtime modes, the create
 * path picks each provider's no-prompt mode for such a run. This table records what a no-mode
 * schedule run starts in today, one row per provider, so the owner's decision is a change to the
 * `expected` column of the rows it affects and nothing else.
 */
const GENERIC_ACP = "pinned-generic-acp";

const registry = buildProviderRegistry(createTestLogger(), {
  providerOverrides: {
    [GENERIC_ACP]: { extends: "acp", label: "Generic ACP", command: ["generic-acp"] },
  },
});

function manifestModes(provider: string) {
  return AGENT_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider)?.modes ?? [];
}

/** The bare modes each provider reports at runtime; the daemon adds the manifest's marks. */
function runtimeModes(provider: string, ids: readonly string[]) {
  const bare = ids.map((id) => ({ id, label: id }));
  return normalizeProviderModes(bare, manifestModes(provider));
}

interface ScheduleRunStart {
  modeId: string | undefined;
  /** The provider's own auto-accept toggle (`auto_accept`), where it has one. */
  autoAccept: unknown;
}

const COPILOT_AGENT = "https://agentclientprotocol.com/protocol/session-modes#agent";
const COPILOT_PLAN = "https://agentclientprotocol.com/protocol/session-modes#plan";

describe("a schedule run with no mode (B-1, current behavior pinned)", () => {
  test.each<[provider: string, modes: readonly string[], expected: ScheduleRunStart]>([
    [
      "claude",
      ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
      { modeId: "bypassPermissions", autoAccept: undefined },
    ],
    [
      "codex",
      ["plan", "auto", "auto-review", "full-access"],
      { modeId: "full-access", autoAccept: undefined },
    ],
    [
      "copilot",
      [COPILOT_AGENT, COPILOT_PLAN, "allow-all"],
      { modeId: "allow-all", autoAccept: true },
    ],
    [GENERIC_ACP, ["default", "yolo"], { modeId: undefined, autoAccept: true }],
    ["opencode", ["build", "plan"], { modeId: undefined, autoAccept: true }],
    ["omp", ["full", "write", "ask"], { modeId: "full", autoAccept: undefined }],
  ])("%s starts in %j", (provider, modes, expected) => {
    const definition = registry[provider];
    if (!definition) throw new Error(`No ${provider} provider`);
    const resolved = definition.resolveCreateConfig({
      provider,
      requestedMode: undefined,
      featureValues: undefined,
      parent: null,
      unattended: true,
      availableModes: runtimeModes(provider, modes),
    });
    expect({
      modeId: resolved.modeId,
      autoAccept: resolved.featureValues?.auto_accept,
    }).toEqual(expected);
  });
});

// An agent's schedule must name a mode that asks (R-a). A run is still an unattended create, so
// the ACP and OpenCode providers turn their own auto_accept on whatever the mode: pinned for the
// same owner decision.
describe("a schedule run with a mode that asks (B-1, current behavior pinned)", () => {
  test.each<[provider: string, modes: readonly string[], mode: string, expected: ScheduleRunStart]>(
    [
      [
        "claude",
        ["default", "bypassPermissions"],
        "default",
        { modeId: "default", autoAccept: undefined },
      ],
      ["codex", ["auto", "full-access"], "auto", { modeId: "auto", autoAccept: undefined }],
      [
        "copilot",
        [COPILOT_AGENT, "allow-all"],
        COPILOT_AGENT,
        { modeId: COPILOT_AGENT, autoAccept: true },
      ],
      [GENERIC_ACP, ["default", "yolo"], "default", { modeId: "default", autoAccept: true }],
      ["opencode", ["build", "plan"], "build", { modeId: "build", autoAccept: true }],
      ["omp", ["full", "ask"], "ask", { modeId: "ask", autoAccept: undefined }],
    ],
  )("%s with %j", (provider, modes, mode, expected) => {
    const definition = registry[provider];
    if (!definition) throw new Error(`No ${provider} provider`);
    const resolved = definition.resolveCreateConfig({
      provider,
      requestedMode: mode,
      featureValues: undefined,
      parent: null,
      unattended: true,
      availableModes: runtimeModes(provider, modes),
    });
    expect({ modeId: resolved.modeId, autoAccept: resolved.featureValues?.auto_accept }).toEqual(
      expected,
    );
  });
});

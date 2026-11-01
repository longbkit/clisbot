import { describe, expect, test, vi } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "@clisbot/protocol/provider-manifest";
import { resolveScheduleDefaultModeId } from "@clisbot/protocol/schedule/default-mode";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { normalizeProviderModes } from "../agent/provider-modes.js";
import { buildProviderRegistry } from "../agent/provider-registry.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import { createScheduleModeResolver, withScheduleMode } from "./schedule-mode.js";

/**
 * Review B-1 on PR #46, decided: a schedule never runs in a no-prompt mode unless someone chose
 * it. One row per provider: what a schedule with no mode runs in, through the real provider
 * registry. On 2.2.1 Claude, Codex, Copilot and OMP ran in their no-prompt mode here, and ACP,
 * Copilot and OpenCode turned their own auto_accept on.
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

describe("a schedule with no mode runs in the provider's asking default", () => {
  test.each<[provider: string, modes: readonly string[], expected: ScheduleRunStart]>([
    [
      "claude",
      ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
      { modeId: "auto", autoAccept: undefined },
    ],
    [
      "codex",
      ["plan", "auto", "auto-review", "full-access"],
      { modeId: "auto-review", autoAccept: undefined },
    ],
    [
      "copilot",
      [COPILOT_AGENT, COPILOT_PLAN, "allow-all"],
      { modeId: COPILOT_AGENT, autoAccept: undefined },
    ],
    [GENERIC_ACP, ["default", "yolo"], { modeId: "default", autoAccept: undefined }],
    ["opencode", ["build", "plan"], { modeId: "build", autoAccept: undefined }],
    ["omp", ["full", "write", "ask"], { modeId: "write", autoAccept: undefined }],
  ])("%s", (provider, ids, expected) => {
    const definition = registry[provider];
    if (!definition) throw new Error(`No ${provider} provider`);
    const availableModes = runtimeModes(provider, ids);
    const resolved = definition.resolveCreateConfig({
      provider,
      requestedMode: resolveScheduleDefaultModeId(availableModes, definition.defaultModeId),
      featureValues: undefined,
      parent: null,
      unattended: false,
      availableModes,
    });
    expect({
      modeId: resolved.modeId,
      autoAccept: resolved.featureValues?.auto_accept,
    }).toEqual(expected);
  });
});

describe("the daemon's schedule mode resolver", () => {
  function snapshots(entry: {
    modes?: { id: string; isUnattended?: boolean }[];
    defaultModeId: string | null;
  }) {
    return {
      getProvider: vi.fn(async () => entry),
    } as unknown as Pick<ProviderSnapshotManager, "getProvider">;
  }

  test("reads the provider snapshot's modes and default", async () => {
    const resolve = createScheduleModeResolver(
      snapshots({
        modes: [{ id: "full", isUnattended: true }, { id: "ask" }],
        defaultModeId: "full",
      }),
      createTestLogger(),
    );
    await expect(resolve("omp", "/work")).resolves.toBe("ask");
  });

  test("falls back to the manifest while the provider has not answered", async () => {
    const resolve = createScheduleModeResolver(
      snapshots({ modes: [], defaultModeId: "full" }),
      createTestLogger(),
    );
    await expect(resolve("omp", "/work")).resolves.toBe("write");
  });

  test("fills only a new-agent target that names no mode", async () => {
    const resolve = async () => "default";
    const bare = { type: "new-agent" as const, config: { provider: "claude", cwd: "/w" } };
    await expect(withScheduleMode(bare, resolve)).resolves.toMatchObject({
      config: { modeId: "default" },
    });
    const chosen = { ...bare, config: { ...bare.config, modeId: "bypassPermissions" } };
    await expect(withScheduleMode(chosen, resolve)).resolves.toBe(chosen);
    const heartbeat = { type: "agent" as const, agentId: "a" };
    await expect(withScheduleMode(heartbeat, resolve)).resolves.toBe(heartbeat);
  });
});

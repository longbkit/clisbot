import { describe, expect, test, vi } from "vitest";
import { assertScheduleModeChosen, type ScheduleProviderModes } from "./mode.js";
import type { ScheduleTarget } from "./types.js";

const CODEX: ScheduleProviderModes = {
  provider: "codex",
  defaultModeId: "auto-review",
  modes: [
    { id: "plan" },
    { id: "auto" },
    { id: "auto-review" },
    { id: "full-access", isUnattended: true },
  ],
};
const PI: ScheduleProviderModes = { provider: "pi", defaultModeId: null, modes: [] };

function client(entries: ScheduleProviderModes[]) {
  return { getProvidersSnapshot: vi.fn(async () => ({ entries })) };
}

function newAgent(provider: string, modeId?: string): ScheduleTarget {
  return {
    type: "new-agent",
    config: { provider, cwd: "/repo", ...(modeId ? { modeId } : {}) },
  };
}

describe("schedule create needs a mode", () => {
  test("without --mode it fails and lists the provider's modes", async () => {
    await expect(assertScheduleModeChosen(client([CODEX]), newAgent("codex"))).rejects.toEqual({
      code: "MODE_REQUIRED",
      message:
        "--mode is required. Modes for codex: plan (plans only), auto (asks), auto-review (default, asks), full-access (runs without asking).",
      details: "Pass --mode auto-review to have each run ask for approval.",
    });
  });

  test("with --mode it passes without asking the daemon", async () => {
    const source = client([CODEX]);
    await expect(
      assertScheduleModeChosen(source, newAgent("codex", "full-access")),
    ).resolves.toBeUndefined();
    expect(source.getProvidersSnapshot).not.toHaveBeenCalled();
  });

  test("a provider without modes needs none", async () => {
    await expect(assertScheduleModeChosen(client([CODEX, PI]), newAgent("pi"))).resolves.toBe(
      undefined,
    );
  });

  test("a built-in provider that has not answered yet uses its manifest's modes", async () => {
    const unavailable = { provider: "omp", modes: [], defaultModeId: null };
    await expect(assertScheduleModeChosen(client([unavailable]), newAgent("omp"))).rejects.toEqual(
      expect.objectContaining({
        message:
          "--mode is required. Modes for omp: full (runs without asking), write (default, asks), ask (asks).",
      }),
    );
  });

  test("a session target has no mode", async () => {
    const source = client([CODEX]);
    await expect(
      assertScheduleModeChosen(source, { type: "agent", agentId: "a" }),
    ).resolves.toBeUndefined();
    expect(source.getProvidersSnapshot).not.toHaveBeenCalled();
  });
});

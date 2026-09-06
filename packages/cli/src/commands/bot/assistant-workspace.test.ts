import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { waitForAssistantProvider } from "./assistant-workspace.js";

afterEach(() => vi.useRealTimers());
describe("assistant provider discovery", () => {
  it("waits through loading snapshots before accepting a cold provider", async () => {
    vi.useFakeTimers();
    const getProvidersSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ entries: [{ provider: "codex", enabled: true, status: "loading" }] })
      .mockResolvedValue({ entries: [{ provider: "codex", enabled: true, status: "ready" }] });
    const result = waitForAssistantProvider(
      { getProvidersSnapshot } as unknown as DaemonClient,
      "codex",
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toBe(true);
  });
  it("does not treat an installed but disabled provider as usable", async () => {
    const getProvidersSnapshot = vi
      .fn()
      .mockResolvedValue({ entries: [{ provider: "codex", enabled: false, status: "ready" }] });
    expect(
      await waitForAssistantProvider({ getProvidersSnapshot } as unknown as DaemonClient, "codex"),
    ).toBe(false);
  });
});

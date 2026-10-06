// upstream: extensions/whatsapp/src/creds-persistence.test.ts@3928bad9bad
// Whatsapp tests cover creds persistence plugin behavior.
import { MAX_TIMER_TIMEOUT_MS } from "@clisbot/channels-core/plugin-sdk/number-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueCredsSave, waitForCredsSaveQueueWithTimeout } from "./creds-persistence.js";

describe("creds-persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("caps oversized credential flush timeouts before scheduling", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const authDir = "oversized-timeout";
    enqueueCredsSave(
      authDir,
      () => undefined,
      () => undefined,
    );

    await waitForCredsSaveQueueWithTimeout(authDir, Number.MAX_SAFE_INTEGER);

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), MAX_TIMER_TIMEOUT_MS);
  });
});

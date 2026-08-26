import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createHostRuntime } from "./host.js";

const recordingInbound = async () => ({ dispatched: false });

describe("createHostRuntime logging", () => {
  it("defaults to a silent logger that has EVERY level (a vertical reads ctx.log?.info)", () => {
    // Regression: a default child logger missing `info` made a vertical's
    // `ctx.log?.info(...)` throw, rejecting the account monitor at boot.
    const runtime = createHostRuntime({ onInboundReply: recordingInbound });
    const log = runtime.logging.getChildLogger({ channel: "slack", account: "work" });
    for (const level of ["debug", "info", "warn", "error"] as const) {
      assert.equal(typeof log[level], "function", `${level} must exist`);
    }
    // None of the levels throw; calls return undefined (silent).
    log.debug?.("x");
    log.info?.("x");
    log.warn("x", { meta: 1 });
    log.error?.("x");
  });

  it("routes through the supplied childLogger factory with its options", () => {
    const seen: Array<{ level: string; message: string; meta: Record<string, unknown> }> = [];
    const runtime = createHostRuntime({
      onInboundReply: recordingInbound,
      childLogger: (options) => {
        const tagged = (meta: unknown): Record<string, unknown> => {
          const base: Record<string, unknown> = { ...options };
          if (typeof meta === "object" && meta !== null) Object.assign(base, meta);
          return base;
        };
        return {
          debug: (message, meta) => seen.push({ level: "debug", message, meta: tagged(meta) }),
          info: (message, meta) => seen.push({ level: "info", message, meta: tagged(meta) }),
          warn: (message, meta) => seen.push({ level: "warn", message, meta: tagged(meta) }),
          error: (message, meta) => seen.push({ level: "error", message, meta: tagged(meta) }),
        };
      },
    });
    runtime.logging
      .getChildLogger({ channel: "slack", account: "work" })
      .info?.("polling", { n: 1 });
    assert.deepEqual(seen, [
      { level: "info", message: "polling", meta: { channel: "slack", account: "work", n: 1 } },
    ]);
  });
});

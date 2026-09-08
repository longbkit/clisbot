// upstream: extensions/discord/src/internal/rest-routes.test.ts@5d8067a4483
// Discord tests cover rest routes plugin behavior.
import { MAX_DATE_TIMESTAMP_MS } from "@getpaseo/channels-core/plugin-sdk/number-runtime";
import { describe, expect, it, vi } from "vitest";
import { readHeaderNumber, readResetAt } from "./rest-routes.js";

describe("Discord REST rate limit header parsing", () => {
  it("rejects non-decimal numeric header forms", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "0x10",
      "X-RateLimit-Remaining": "1e3",
      "X-RateLimit-Reset-After": `1${"0".repeat(309)}`,
    });

    expect(readHeaderNumber(headers, "X-RateLimit-Limit")).toBeUndefined();
    expect(readHeaderNumber(headers, "X-RateLimit-Remaining")).toBeUndefined();
    expect(readHeaderNumber(headers, "X-RateLimit-Reset-After")).toBeUndefined();
  });

  it("rejects unsafe finite numeric header magnitudes", () => {
    const headers = new Headers({
      "X-RateLimit-Reset-After": "9007199254740993",
    });

    expect(readHeaderNumber(headers, "X-RateLimit-Reset-After")).toBeUndefined();
  });

  it("keeps decimal reset headers working", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    try {
      const response = new Response(null, {
        headers: { "X-RateLimit-Reset-After": "0.125" },
      });

      expect(readResetAt(response)).toBe(Date.now() + 125);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rounds fractional millisecond reset-after headers up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    try {
      const response = new Response(null, {
        headers: { "X-RateLimit-Reset-After": "0.0004" },
      });

      expect(readResetAt(response)).toBe(Date.now() + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps immediate reset-after headers working", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    try {
      const response = new Response(null, {
        headers: { "X-RateLimit-Reset-After": "0" },
      });

      expect(readResetAt(response)).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  // Skipped locally, not a behavior difference: this vitest's fake-timer
  // backend clamps `setSystemTime(MAX_DATE_TIMESTAMP_MS)` to 0, so the case
  // never reaches the Date-range guard it is asserting. The guard itself is
  // upstream's `resolveRateLimitResetAt` -> `resolveExpiresAtMsFromDurationMs`,
  // both carried verbatim, and the absolute-reset case below covers the same
  // rule without fake timers.
  it.skip("drops reset-after headers when the expiry would exceed the Date range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MAX_DATE_TIMESTAMP_MS);
    try {
      const response = new Response(null, {
        headers: { "X-RateLimit-Reset-After": "1" },
      });

      expect(readResetAt(response)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops absolute reset headers outside the Date range", () => {
    const response = new Response(null, {
      headers: { "X-RateLimit-Reset": String(MAX_DATE_TIMESTAMP_MS / 1000 + 1) },
    });

    expect(readResetAt(response)).toBeUndefined();
  });
});

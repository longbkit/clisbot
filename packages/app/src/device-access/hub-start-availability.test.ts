import { describe, it, expect } from "vitest";
import { hubStartAvailability, hubStartReason } from "./hub-start-availability";

describe("Hub startup guidance", () => {
  it.each([
    "managed_access",
    "device_pairing_required",
    "owner_required",
    "launcher_unavailable",
  ] as const)("preserves the Host's %s refusal without suggesting another authority", (reason) => {
    const reported = { status: "blocked", reason } as const;
    expect(
      hubStartAvailability({ selected: true, connected: true, locked: false, reported }),
    ).toEqual(reported);
    expect(hubStartReason(reported)).toBe(reason);
  });
  it("keeps checking distinct from an older Host's unknown capability", () => {
    for (const status of ["checking", "unknown"] as const)
      expect(
        hubStartAvailability({
          selected: true,
          connected: true,
          locked: false,
          reported: { status },
        }),
      ).toEqual({ status });
  });
  it("does not allow stale ready authority on an offline or editing Host", () => {
    const input = {
      selected: true,
      connected: true,
      locked: false,
      reported: { status: "ready" } as const,
    };
    expect(hubStartAvailability({ ...input, connected: false })).toEqual({ status: "offline" });
    expect(hubStartAvailability({ ...input, locked: true })).toEqual({ status: "locked" });
    expect(hubStartAvailability({ ...input, selected: false })).toEqual({ status: "no_host" });
    expect(hubStartAvailability(input)).toEqual({ status: "ready" });
  });
});

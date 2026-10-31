import { describe, expect, it } from "vitest";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { schedulesConnectionKey, schedulesQueryKey } from "@/hooks/use-schedules";

function key(entries: Record<string, HostRuntimeConnectionStatus>) {
  return schedulesConnectionKey(Object.keys(entries), new Map(Object.entries(entries)));
}

describe("schedulesConnectionKey", () => {
  it("ignores flips that cannot change which Hosts are asked or whether one is settling", () => {
    const before = key({ a: "online", b: "connecting", c: "offline", d: "error" });
    expect(key({ a: "online", b: "connecting", c: "error", d: "offline" })).toBe(before);
    expect(key({ a: "online", b: "connecting", c: "connecting", d: "offline" })).toBe(before);
  });

  it("changes when a Host comes online or the last one stops settling", () => {
    const before = key({ a: "online", b: "connecting", c: "offline" });
    expect(key({ a: "online", b: "online", c: "offline" })).not.toBe(before);
    expect(key({ a: "online", b: "offline", c: "offline" })).not.toBe(before);
  });
});

describe("schedulesQueryKey", () => {
  it("uses only the sorted host identity", () => {
    expect(schedulesQueryKey(["laptop", "local"])).toEqual(["schedules", "laptop|local"]);
    expect(schedulesQueryKey(["local", "laptop"])).toEqual(["schedules", "laptop|local"]);
  });
});

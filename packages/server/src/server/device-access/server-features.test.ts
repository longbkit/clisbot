import { expect, test } from "vitest";
import { buildDeviceAccessServerFeatures, getHubLocalStartStatus } from "./server-features.js";

const ready = {
  hasDeviceAuthority: true,
  hasLocalHubLauncher: true,
  managedAccessMode: "off" as const,
  canStartLocalHub: true,
};

test.each([
  [{ ...ready, managedAccessMode: "external" as const }, "managed_access"],
  [{ ...ready, hasDeviceAuthority: false, hasLocalHubLauncher: false }, "device_pairing_required"],
  [{ ...ready, canStartLocalHub: false }, "owner_required"],
  [{ ...ready, hasLocalHubLauncher: false }, "launcher_unavailable"],
] as const)(
  "startup explains the blocker and never advertises permission to start: %j",
  (options, reason) => {
    const status = getHubLocalStartStatus(options);
    expect(status).toEqual({ status: "blocked", reason });
    const features = buildDeviceAccessServerFeatures({
      hasDeviceAuthority: options.hasDeviceAuthority,
      hasHubRelationships: true,
      hasHostTailscale: true,
      canStartLocalHub: () => options.canStartLocalHub,
      localHubStartStatus: status,
    });
    expect(features.localHubStart).toBeUndefined();
    expect(features.localHubStartStatus).toBe(true);
  },
);

test("owner eligibility changes when authority is removed and when managed access is enabled", () => {
  expect(getHubLocalStartStatus(ready)).toEqual({ status: "ready" });
  expect(getHubLocalStartStatus({ ...ready, canStartLocalHub: false })).toEqual({
    status: "blocked",
    reason: "owner_required",
  });
  expect(getHubLocalStartStatus({ ...ready, managedAccessMode: "external" })).toEqual({
    status: "blocked",
    reason: "managed_access",
  });
  expect(getHubLocalStartStatus(ready)).toEqual({ status: "ready" });
});

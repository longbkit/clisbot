import { describe, expect, it } from "vitest";
import { HubDaemonSchema } from "./contracts";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";

const daemon = {
  id: "daemon-1",
  slug: "workstation",
  status: "active",
  presence: "connected",
  connectedAt: null,
  lastSeenAt: "2026-09-03T00:00:00.000Z",
  canManage: true,
  connectionOffer: null,
};

describe("Hub-managed Host admission", () => {
  it("keeps older Hub projections on ordinary Paseo trust", () => {
    const parsed = HubDaemonSchema.parse(daemon);

    expect(parsed.managedAccessMode).toBe("off");
    expect(hubManagedHostRequiresAccessTicket(parsed.managedAccessMode)).toBe(false);
  });

  it("requests access tickets only for external managed access", () => {
    const parsed = HubDaemonSchema.parse({ ...daemon, managedAccessMode: "external" });

    expect(hubManagedHostRequiresAccessTicket(parsed.managedAccessMode)).toBe(true);
  });
});

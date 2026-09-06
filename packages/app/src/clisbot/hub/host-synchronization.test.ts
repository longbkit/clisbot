import { describe, expect, it } from "vitest";
import { HubDaemonSchema } from "./contracts";
import {
  HUB_HOST_DISCOVERY_INTERVAL_MS,
  findNewlyEnrolledHost,
  hubHostDiscoveryRefetchInterval,
} from "./managed-host-discovery";
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

  it("polls only during a bounded post-approval Host discovery window", () => {
    expect(
      hubHostDiscoveryRefetchInterval({ deadline: 10_000, now: 1_000, hostDiscovered: false }),
    ).toBe(HUB_HOST_DISCOVERY_INTERVAL_MS);
    expect(
      hubHostDiscoveryRefetchInterval({ deadline: 10_000, now: 1_000, hostDiscovered: true }),
    ).toBe(false);
    expect(
      hubHostDiscoveryRefetchInterval({ deadline: 10_000, now: 10_000, hostDiscovered: false }),
    ).toBe(false);
  });

  it("detects a newly enrolled Daemon after its Host is added or reused", () => {
    const host = (serverId: string) => ({ serverId });
    const daemonReference = (id: string, serverId: string | null) => ({
      id,
      connectionOffer: serverId === null ? null : { serverId },
    });
    expect(
      findNewlyEnrolledHost({
        hosts: [host("server-old"), host("server-new")],
        daemons: [
          daemonReference("old", "server-old"),
          daemonReference("pending", null),
          daemonReference("new", "server-new"),
        ],
        baseline: [daemonReference("old", "server-old")],
      }),
    ).toEqual(host("server-new"));
  });
});

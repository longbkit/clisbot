import { describe, expect, it } from "vitest";
import { orphanedManagedHosts } from "./managed-host-reconciliation";

const hubOrigin = "https://hub.example.test";
const organizationId = "org";

function management(
  daemonId: string,
  overrides: Partial<{ hubOrigin: string; organizationId: string }> = {},
) {
  return {
    kind: "hub" as const,
    hubOrigin,
    organizationId,
    daemonId,
    ...overrides,
  };
}

describe("orphanedManagedHosts", () => {
  it("returns a Hub-managed Host whose daemon left the projection", () => {
    expect(
      orphanedManagedHosts({
        hosts: [{ management: management("kept") }, { management: management("gone") }],
        projectedDaemonIds: new Set(["kept"]),
        hubOrigin,
        organizationId,
      }),
    ).toEqual([management("gone")]);
  });

  it("leaves manual Hosts and other Hubs' or organizations' Hosts alone", () => {
    expect(
      orphanedManagedHosts({
        hosts: [
          {},
          { management: management("gone", { hubOrigin: "https://other.test" }) },
          { management: management("gone", { organizationId: "other" }) },
        ],
        projectedDaemonIds: new Set(),
        hubOrigin,
        organizationId,
      }),
    ).toEqual([]);
  });
});

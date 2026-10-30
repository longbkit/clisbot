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
        hubOrigin,
        answer: { kind: "listed", organizationId, projectedDaemonIds: new Set(["kept"]) },
      }),
    ).toEqual([management("gone")]);
  });

  it("returns this Hub's Hosts managed under an organization the account no longer reads", () => {
    expect(
      orphanedManagedHosts({
        hosts: [
          { management: management("kept") },
          { management: management("kept", { organizationId: "previous" }) },
        ],
        hubOrigin,
        answer: { kind: "listed", organizationId, projectedDaemonIds: new Set(["kept"]) },
      }),
    ).toEqual([management("kept", { organizationId: "previous" })]);
  });

  it("returns every Host of this Hub once the Hub answers that the account is signed out", () => {
    expect(
      orphanedManagedHosts({
        hosts: [
          { management: management("a") },
          { management: management("b", { organizationId: "other" }) },
        ],
        hubOrigin,
        answer: { kind: "signedOut" },
      }),
    ).toEqual([management("a"), management("b", { organizationId: "other" })]);
  });

  it("leaves manual Hosts and other Hubs' Hosts alone", () => {
    for (const answer of [
      { kind: "signedOut" as const },
      { kind: "listed" as const, organizationId, projectedDaemonIds: new Set<string>() },
    ]) {
      expect(
        orphanedManagedHosts({
          hosts: [{}, { management: management("gone", { hubOrigin: "https://other.test" }) }],
          hubOrigin,
          answer,
        }),
      ).toEqual([]);
    }
  });
});

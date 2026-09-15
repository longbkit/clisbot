import { describe, expect, it } from "vitest";
import { isHubProvidedConnection } from "./managed-access";

const management = {
  kind: "hub" as const,
  hubOrigin: "https://hub.example.test",
  organizationId: "org",
  daemonId: "daemon",
};

describe("isHubProvidedConnection", () => {
  it("keeps the connections a user saved before Hub was attached as theirs", () => {
    const host = { management: { ...management, manualConnectionIds: ["direct:localhost:6768"] } };
    expect(isHubProvidedConnection(host, { id: "direct:localhost:6768" })).toBe(false);
    expect(isHubProvidedConnection(host, { id: "relay:wss:relay.paseo.sh:443" })).toBe(true);
  });

  it("treats every connection of a Hub-created Host as provided, and none of a manual Host", () => {
    expect(isHubProvidedConnection({ management }, { id: "relay:x" })).toBe(true);
    expect(isHubProvidedConnection({}, { id: "relay:x" })).toBe(false);
  });
});

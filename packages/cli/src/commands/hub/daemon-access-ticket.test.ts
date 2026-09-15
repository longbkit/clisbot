import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDaemonAccessTicketResolver,
  requiresDaemonAccessTicket,
} from "./daemon-access-ticket.js";

function paseoHome(files: Record<string, unknown>): string {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-cli-ticket-"));
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(home, name), JSON.stringify(value));
  }
  return home;
}

const relationship = {
  state: "active",
  relationship: { daemonId: "daemon-1", hubOrigin: "https://hub.test" },
};

describe("daemon access tickets for the CLI", () => {
  it("recognizes the daemon asking for a Hub ticket", () => {
    expect(requiresDaemonAccessTicket(new Error("Managed access ticket required"))).toBe(true);
    expect(requiresDaemonAccessTicket(new Error("Connection refused"))).toBe(false);
  });

  it("has no ticket to offer when the daemon is not enrolled or the CLI is not logged in", () => {
    const unenrolled = paseoHome({});
    expect(
      createDaemonAccessTicketResolver({
        paseoHome: unenrolled,
        clientId: "cid",
        env: { PASEO_HOME: unenrolled },
      }),
    ).toBeNull();

    const loggedOut = paseoHome({ "hub-relationship.json": relationship });
    expect(
      createDaemonAccessTicketResolver({
        paseoHome: loggedOut,
        clientId: "cid",
        env: { PASEO_HOME: loggedOut },
      }),
    ).toBeNull();
  });

  it("offers a ticket resolver for an enrolled daemon whose Hub this CLI is logged in to", () => {
    const home = paseoHome({
      "hub-relationship.json": relationship,
      "hub-credentials.json": {
        version: 1,
        activeOrigin: "https://hub.test",
        credentials: [{ origin: "https://hub.test", credential: "paseo_cli_abc_secret" }],
      },
    });
    expect(
      createDaemonAccessTicketResolver({
        paseoHome: home,
        clientId: "cid",
        env: { PASEO_HOME: home },
      }),
    ).toBeTypeOf("function");
  });
});

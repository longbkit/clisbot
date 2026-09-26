import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { HUB_RELATIONSHIP_FILE_NAME, homeRequiresTickets } from "./hub-membership.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "hub-membership-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function saveRelationship(contents: string): void {
  writeFileSync(path.join(home, HUB_RELATIONSHIP_FILE_NAME), contents);
}

describe("Managed Access in a Paseo home", () => {
  it("defaults to external, and an explicit mode wins", () => {
    expect(loadConfig(home, { env: { PASEO_HOME: home } }).managedAccessMode).toBe("external");
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ version: 1, daemon: { managedAccess: { mode: "off" } } }),
    );
    expect(loadConfig(home, { env: { PASEO_HOME: home } }).managedAccessMode).toBe("off");
  });

  it("asks for tickets only once the home belongs to a Hub", () => {
    expect(homeRequiresTickets(home)).toBe(false);
    saveRelationship(JSON.stringify({ state: "pending" }));
    expect(homeRequiresTickets(home)).toBe(false);
    for (const state of ["active", "disconnecting", "revoked"]) {
      saveRelationship(JSON.stringify({ state }));
      expect(homeRequiresTickets(home)).toBe(true);
    }
  });

  it("keeps asking when the relationship cannot be read", () => {
    saveRelationship("{");
    expect(homeRequiresTickets(home)).toBe(true);
  });
});

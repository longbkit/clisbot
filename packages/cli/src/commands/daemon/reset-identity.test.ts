import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetDaemonIdentity } from "./reset-identity.js";

function home(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-reset-identity-"));
  for (const file of ["server-id", "daemon-keypair.json", "hub-relationship.json", "config.json"]) {
    writeFileSync(path.join(directory, file), file === "config.json" ? "{}" : "x");
  }
  return directory;
}

describe("paseo daemon reset-identity", () => {
  it("removes the identity files and keeps the rest of the Paseo home", () => {
    const directory = home();
    const result = resetDaemonIdentity({ home: directory, env: {} });

    expect(result.removed).toBe("server-id, daemon-keypair.json, hub-relationship.json");
    expect(existsSync(path.join(directory, "server-id"))).toBe(false);
    expect(existsSync(path.join(directory, "config.json"))).toBe(true);
    expect(result.nextSteps).toContain("paseo hub login");
  });

  it("refuses while PASEO_SERVER_ID would recreate the same identity", () => {
    const directory = home();
    expect(() =>
      resetDaemonIdentity({ home: directory, env: { PASEO_SERVER_ID: "srv_x" } }),
    ).toThrow();
    expect(existsSync(path.join(directory, "server-id"))).toBe(true);
  });
});

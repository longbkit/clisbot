import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetDaemonIdentity } from "./reset-identity.js";

function home(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "clisbot-reset-identity-"));
  for (const file of ["server-id", "daemon-keypair.json", "hub-relationship.json", "config.json"]) {
    writeFileSync(path.join(directory, file), file === "config.json" ? "{}" : "x");
  }
  return directory;
}

describe("clisbot daemon reset-identity", () => {
  it("removes the identity files and keeps the rest of the Clisbot home", async () => {
    const directory = home();
    const result = await resetDaemonIdentity({ home: directory, env: {} });

    expect(result.removed).toBe("server-id, daemon-keypair.json, hub-relationship.json");
    expect(existsSync(path.join(directory, "server-id"))).toBe(false);
    expect(existsSync(path.join(directory, "config.json"))).toBe(true);
    expect(result.nextSteps).toContain("clisbot hub login");
  });

  it("refuses while CLISBOT_SERVER_ID would recreate the same identity", async () => {
    const directory = home();
    await expect(
      resetDaemonIdentity({ home: directory, env: { CLISBOT_SERVER_ID: "srv_x" } }),
    ).rejects.toThrow();
    expect(existsSync(path.join(directory, "server-id"))).toBe(true);
  });
});

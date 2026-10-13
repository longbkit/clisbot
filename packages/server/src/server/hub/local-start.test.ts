import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { assertHostLocalHubStartPolicy } from "./local-start.js";
import { HUB_RELATIONSHIP_FILE_NAME } from "../managed-access/hub-membership.js";

it("the actual launch preflight permits the unenrolled external default and refuses enrolled/revoked/corrupt homes", () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-launch-policy-"));
  const config = { features: { devicePairing: true } };
  try {
    expect(() => assertHostLocalHubStartPolicy(home, config)).not.toThrow();
    expect(() => assertHostLocalHubStartPolicy(home, {})).toThrow("Protected device access");
    for (const state of ["active", "revoked", "disconnecting", "unknown"]) {
      writeFileSync(path.join(home, HUB_RELATIONSHIP_FILE_NAME), JSON.stringify({ state }));
      expect(() => assertHostLocalHubStartPolicy(home, config)).toThrow("managed access");
    }
    writeFileSync(path.join(home, HUB_RELATIONSHIP_FILE_NAME), "{");
    expect(() => assertHostLocalHubStartPolicy(home, config)).toThrow("managed access");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

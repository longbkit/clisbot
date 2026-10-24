import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveClisbotHome } from "./clisbot-home.js";
describe("resolveClisbotHome", () => {
  test("resolves CLISBOT_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "clisbot-home-parent-"));
    const clisbotHome = path.join(parent, "home");
    try {
      expect(resolveClisbotHome({ CLISBOT_HOME: clisbotHome })).toBe(clisbotHome);
      expect(existsSync(clisbotHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

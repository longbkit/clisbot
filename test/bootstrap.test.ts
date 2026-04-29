import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTemplateRoot } from "../src/agents/bootstrap.ts";

describe("bootstrap template root resolution", () => {
  test("resolves repo layout from src/agents", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "clisbot-bootstrap-paths-"));

    try {
      const moduleDir = join(baseDir, "src", "agents");
      mkdirSync(join(baseDir, "templates", "default"), { recursive: true });
      mkdirSync(join(baseDir, "templates", "customized"), { recursive: true });
      mkdirSync(moduleDir, { recursive: true });

      expect(resolveTemplateRoot(moduleDir)).toBe(join(baseDir, "templates"));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("resolves packaged layout from dist", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "clisbot-bootstrap-paths-"));

    try {
      const moduleDir = join(baseDir, "dist");
      mkdirSync(join(baseDir, "templates", "default"), { recursive: true });
      mkdirSync(join(baseDir, "templates", "customized"), { recursive: true });
      mkdirSync(moduleDir, { recursive: true });

      expect(resolveTemplateRoot(moduleDir)).toBe(join(baseDir, "templates"));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

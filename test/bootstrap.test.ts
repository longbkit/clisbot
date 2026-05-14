import { describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, mkdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBootstrapTemplate,
  getBootstrapWorkspaceState,
  resolveTemplateRoot,
} from "../src/agents/runtime/bootstrap.ts";

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

  test("claude bootstrap keeps AGENTS.md canonical and creates a discovery symlink", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "clisbot-bootstrap-workspace-"));

    try {
      await applyBootstrapTemplate(workspacePath, "personal-assistant", "claude");

      const claudePath = join(workspacePath, "CLAUDE.md");
      expect(lstatSync(claudePath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(claudePath)).toBe("AGENTS.md");
      expect(getBootstrapWorkspaceState(workspacePath, "personal-assistant", "claude")).toBe(
        "not-bootstrapped",
      );
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});

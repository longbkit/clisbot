import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { seedWorkspaceTemplate } from "./workspace-template.js";

describe("assistant workspace templates", () => {
  it("backs up edited context before an explicit overwrite and leaves unrelated files alone", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bot-template-overwrite-"));
    try {
      await seedWorkspaceTemplate(directory, "personal");
      await writeFile(path.join(directory, "USER.md"), "My existing context");
      await writeFile(path.join(directory, "notes.md"), "My notes");
      const result = await seedWorkspaceTemplate(directory, "team", true);
      expect(result.overwritten).toHaveLength(9);
      expect(result.backupDirectory).toBeTruthy();
      expect(await readFile(path.join(result.backupDirectory!, "USER.md"), "utf8")).toBe(
        "My existing context",
      );
      expect(await readFile(path.join(directory, "USER.md"), "utf8")).not.toBe(
        "My existing context",
      );
      expect(await readFile(path.join(directory, "SOUL.md"), "utf8")).toContain("team assistant");
      expect(await readFile(path.join(directory, "notes.md"), "utf8")).toBe("My notes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("seeds the selected workspace and preserves user files across retries and persona changes", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "bot-template-"));
    try {
      const directory = path.join(home, "workspaces", "default");
      const first = await seedWorkspaceTemplate(directory, "personal");
      expect(first.created).toContain("AGENTS.md");
      expect(await readFile(path.join(directory, "SOUL.md"), "utf8")).toContain(
        "personal assistant",
      );
      await writeFile(path.join(directory, "USER.md"), "User-owned context");
      const second = await seedWorkspaceTemplate(directory, "team");
      expect(second.created).toEqual([]);
      expect(second.skipped).toEqual(first.created);
      expect(await readFile(path.join(directory, "USER.md"), "utf8")).toBe("User-owned context");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not follow an existing template symlink", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bot-template-link-"));
    try {
      const target = path.join(directory, "original.md");
      await writeFile(target, "Keep me");
      await symlink(target, path.join(directory, "AGENTS.md"));
      const result = await seedWorkspaceTemplate(directory, "team", true);
      expect(result.skipped).toContain("AGENTS.md");
      expect(await readFile(target, "utf8")).toBe("Keep me");
      expect(await readFile(path.join(directory, "SOUL.md"), "utf8")).toContain("team assistant");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

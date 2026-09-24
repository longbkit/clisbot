import { mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { seedWorkspaceTemplate, workspaceTemplate } from "./workspace-template.js";

const mainTemplateHashes = {
  personal: {
    "AGENTS.md": "5331f8401904e43d20a9a46a6b9a35ceb7e462414f583a2c7f8b56d3ae6cc814",
    "BOOTSTRAP.md": "cc9ae113bffa1e8027beec5e9d037cff8b9c6a1b7738726573e0f7efe00a8ff0",
    "IDENTITY.md": "307df1b50fad2fb950ad2d34a9407d2b67b593dba106d4d3da911c18f2495403",
    "LOOP.md": "51848831b4c25674b2e0e42b784f40a57ea3632a250eef3ae2d64685cbb7eaec",
    "MEMORY.md": "b6840326af7706cd62747d1a4f5563be38abbd48f7b9e0a4e97b4cd9f45750a1",
    "README.md": "1aa017724250ea9aee183b97bb39484663ec1078e7fbe8e123590bb20fc00773",
    "SOUL.md": "95c467f710183b2c0397c29ec4ef886bb723671a39ee767dc4d59165f723b68f",
    "TOOLS.md": "78f3e26b8625ea283c615cec291d4978da5f9f01df730628c5c42094418b8dc2",
    "USER.md": "e840c863fe26cc4d868a03529d319986f8902ae7c6bc3c9956442c269edee55e",
  },
  team: {
    "AGENTS.md": "9abf969f3fce5eaab0591030bc0ce93759b8c2a57133447bd7e6e49732cb9b6f",
    "BOOTSTRAP.md": "cc9ae113bffa1e8027beec5e9d037cff8b9c6a1b7738726573e0f7efe00a8ff0",
    "IDENTITY.md": "307df1b50fad2fb950ad2d34a9407d2b67b593dba106d4d3da911c18f2495403",
    "LOOP.md": "51848831b4c25674b2e0e42b784f40a57ea3632a250eef3ae2d64685cbb7eaec",
    "MEMORY.md": "e7609c7812dd34b7c47b8e440b608bd70bd6d5c75b35067378ecd97fda8fac00",
    "README.md": "1aa017724250ea9aee183b97bb39484663ec1078e7fbe8e123590bb20fc00773",
    "SOUL.md": "95c467f710183b2c0397c29ec4ef886bb723671a39ee767dc4d59165f723b68f",
    "TOOLS.md": "78f3e26b8625ea283c615cec291d4978da5f9f01df730628c5c42094418b8dc2",
    "USER.md": "2ff5bca992ee0ffb4a5c50c01799c7c93490d024a639ea25554728728fde420b",
  },
} as const;

describe("assistant workspace templates", () => {
  it("matches the pinned main catalog except the documented Fusion bootstrap instruction", () => {
    for (const type of ["personal", "team"] as const) {
      const files = workspaceTemplate(type);
      expect(Object.keys(files).sort()).toEqual(Object.keys(mainTemplateHashes[type]).sort());
      for (const [name, content] of Object.entries(files)) {
        expect(createHash("sha256").update(content).digest("hex")).toBe(
          mainTemplateHashes[type][name as keyof typeof mainTemplateHashes.personal],
        );
      }
    }
    expect(workspaceTemplate("personal")["BOOTSTRAP.md"]).not.toContain(
      "clisbot routes get-timezone",
    );
  });

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
      expect(await readFile(path.join(directory, "AGENTS.md"), "utf8")).toContain(
        "shared team context",
      );
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
      expect(await readFile(path.join(directory, "MEMORY.md"), "utf8")).toContain(
        "Personal Long-Term Memory",
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
      expect(await readFile(path.join(directory, "MEMORY.md"), "utf8")).toContain(
        "Team Long-Term Memory",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts bootstrap in a repo with pre-existing context files but no complete template set", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bot-template-existing-repo-"));
    try {
      for (const name of ["AGENTS.md", "USER.md", "IDENTITY.md", "SOUL.md", "MEMORY.md"]) {
        await writeFile(path.join(directory, name), `Existing ${name}\n`);
      }
      const result = await seedWorkspaceTemplate(directory, "personal");
      expect(result.created).toContain("BOOTSTRAP.md");
      expect(result.created).toContain("TOOLS.md");
      expect(await readFile(path.join(directory, "AGENTS.md"), "utf8")).toBe(
        "Existing AGENTS.md\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the main provider discovery symlink and preserves completed bootstrap", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bot-template-discovery-"));
    try {
      const first = await seedWorkspaceTemplate(directory, "team", false, "claude");
      expect(first.created).toContain("CLAUDE.md");
      expect(await readlink(path.join(directory, "CLAUDE.md"))).toBe("AGENTS.md");
      await rm(path.join(directory, "BOOTSTRAP.md"));
      const second = await seedWorkspaceTemplate(directory, "team", false, "claude");
      expect(second.created).toEqual([]);
      await expect(readFile(path.join(directory, "BOOTSTRAP.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const third = await seedWorkspaceTemplate(directory, "team", true, "claude");
      expect(third.created).toContain("BOOTSTRAP.md");
      expect(await readlink(path.join(directory, "CLAUDE.md"))).toBe("AGENTS.md");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

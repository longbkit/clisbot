import { mkdtemp, realpath, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { browseProjectDirectories } from "./browse-project-directories.js";

let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "clisbot-folder-browser-")));
  await Promise.all(
    ["home", "workspace", "workspace/research", "workspace/code", "workspace/.secret"].map((name) =>
      mkdir(path.join(root, name), { recursive: true }),
    ),
  );
  await writeFile(path.join(root, "workspace/notes.txt"), "notes");
  return {
    home: path.join(root, "home"),
    query: "",
    filter: async (entries: { path: string }[]) => entries,
    canSelect: async () => true,
  };
}

it("browses directories outside home one level at a time and returns the parent", async () => {
  const input = await fixture();
  const result = await browseProjectDirectories({
    ...input,
    browsePath: path.join(root, "workspace"),
  });
  expect(result.entries.map((entry) => path.basename(entry.path))).toEqual(["code", "research"]);
  expect(result.directory).toMatchObject({ parentPath: root, canSelect: true, truncated: false });
  expect((await browseProjectDirectories({ ...input, browsePath: "~" })).directory.path).toBe(
    input.home,
  );
});

it("checks current-folder authority and filters children before limiting", async () => {
  const input = await fixture();
  await expect(
    browseProjectDirectories({ ...input, browsePath: root, filter: async () => [] }),
  ).rejects.toThrow("access");
  const result = await browseProjectDirectories({
    ...input,
    browsePath: path.join(root, "workspace"),
    limit: 1,
    filter: async (entries) => entries.filter((entry) => !entry.path.endsWith("/code")),
    canSelect: async () => false,
  });
  expect(result.entries.map((entry) => path.basename(entry.path))).toEqual(["research"]);
  expect(result.directory.canSelect).toBe(false);
  expect(result.directory.truncated).toBe(false);
});

it("passes symlinks to the canonical authorization filter and supports filtering beyond the limit", async () => {
  const input = await fixture();
  await symlink(input.home, path.join(root, "workspace/linked"));
  const result = await browseProjectDirectories({
    ...input,
    browsePath: path.join(root, "workspace"),
    query: "research",
    limit: 1,
  });
  expect(result.entries.map((entry) => path.basename(entry.path))).toEqual(["research"]);
  const all = await browseProjectDirectories({
    ...input,
    browsePath: path.join(root, "workspace"),
    limit: 1,
  });
  expect(all.directory.truncated).toBe(true);
  const linked = await browseProjectDirectories({
    ...input,
    browsePath: path.join(root, "workspace/linked"),
  });
  expect(linked.directory.path).toBe(input.home);
  await expect(
    browseProjectDirectories({ ...input, browsePath: path.join(root, "missing") }),
  ).rejects.toThrow();
});

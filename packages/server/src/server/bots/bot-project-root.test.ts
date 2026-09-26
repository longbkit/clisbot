import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { assertNotBotProjectRoot } from "./bot-project-root.js";

test("reserves the Bot root including aliases, permits Bot homes, and is inert without a root", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-root-"));
  try {
    const root = path.join(dir, "homes");
    const alias = path.join(dir, "alias");
    await mkdir(root);
    await symlink(root, alias);
    await expect(assertNotBotProjectRoot(root, root)).rejects.toThrow("cannot be opened");
    await expect(assertNotBotProjectRoot(alias, root)).rejects.toThrow("cannot be opened");
    await expect(assertNotBotProjectRoot(path.join(root, "ceo"), root)).resolves.toBeUndefined();
    await expect(assertNotBotProjectRoot(root, undefined)).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

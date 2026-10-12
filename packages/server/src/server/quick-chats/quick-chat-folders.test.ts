import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateQuickChatFolder,
  fenceQuickChatsFromGit,
  isQuickChatPath,
  quickChatFolderName,
  quickChatsRoot,
} from "./quick-chat-folders.js";

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "quick-chats-"));
  dirs.push(dir);
  return dir;
}

describe("quick chat folders", () => {
  it("names a folder from the day, the first words and a suffix", () => {
    const now = new Date("2026-10-10T08:00:00Z");
    expect(quickChatFolderName("Convert these PNGs to WebP, please now!", now, "a1b2c3d4")).toBe(
      "2026-10-10-convert-these-pngs-to-webp-a1b2c3d4",
    );
    expect(quickChatFolderName("  ✨ ", now, "ff")).toBe("2026-10-10-chat-ff");
    expect(quickChatFolderName(null, now, "ff")).toBe("2026-10-10-chat-ff");
  });

  it("gives every chat its own folder under the Host-wide root", async () => {
    const home = await tempDir();
    const first = await allocateQuickChatFolder(home, "1+1");
    const second = await allocateQuickChatFolder(home, "1+1");
    expect(first).not.toBe(second);
    expect(await readdir(quickChatsRoot(home))).toHaveLength(2);
    expect(isQuickChatPath(first, home)).toBe(true);
    expect(isQuickChatPath(quickChatsRoot(home), home)).toBe(true);
    expect(isQuickChatPath(join(home, "quick-chats-other"), home)).toBe(false);
  });

  it("keeps a chat folder out of a repository that contains the Clisbot home", async () => {
    const repo = await tempDir();
    await run("git", ["init", "-q", repo]);
    const home = join(repo, ".clisbot");
    const folder = await allocateQuickChatFolder(home, "hello");
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CEILING_DIRECTORIES: "" };
    await expect(
      run("git", ["rev-parse", "--show-toplevel"], { cwd: folder, env }),
    ).resolves.toBeTruthy();
    fenceQuickChatsFromGit(home, env);
    fenceQuickChatsFromGit(home, env);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(quickChatsRoot(home));
    await expect(
      run("git", ["rev-parse", "--show-toplevel"], { cwd: folder, env }),
    ).rejects.toThrow();
  });
});

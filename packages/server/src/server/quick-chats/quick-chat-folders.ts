import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";

/**
 * Quick chats live in one Host-wide folder, one subfolder per chat. The folder is never a git
 * checkout: it sits inside the Clisbot home, and a home inside a repository (a dev checkout, a
 * dotfiles home) would otherwise make every chat part of that repository.
 */
export function quickChatsRoot(clisbotHome: string): string {
  return join(resolve(clisbotHome), "quick-chats");
}

export function isQuickChatPath(path: string, clisbotHome: string): boolean {
  const root = quickChatsRoot(clisbotHome);
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

/**
 * Stops git's upward search at the Quick chats folder for this process and every process it
 * starts (agents and their shells inherit it), so a chat folder never resolves to an outer repo.
 * The daemon's own reads of the folder itself are answered by `isQuickChatPath`.
 */
export function fenceQuickChatsFromGit(clisbotHome: string, env: NodeJS.ProcessEnv = process.env) {
  const root = quickChatsRoot(clisbotHome);
  const current = (env.GIT_CEILING_DIRECTORIES ?? "").split(delimiter).filter(Boolean);
  if (current.includes(root)) return;
  env.GIT_CEILING_DIRECTORIES = [...current, root].join(delimiter);
}

/** `2026-10-10-convert-these-pngs-to-webp-a1b2c3d4`: readable on disk, never reused. */
export function quickChatFolderName(prompt: string | null, now: Date, suffix: string): string {
  const day = now.toISOString().slice(0, 10);
  const words = (prompt ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return [day, words || "chat", suffix].join("-");
}

/** Claims a new folder for one chat; a name taken by a concurrent claim moves to a new suffix. */
export async function allocateQuickChatFolder(
  clisbotHome: string,
  prompt: string | null,
  now = new Date(),
): Promise<string> {
  const root = quickChatsRoot(clisbotHome);
  await mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const folder = join(root, quickChatFolderName(prompt, now, randomBytes(4).toString("hex")));
    try {
      await mkdir(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not create a folder for this Quick chat");
}

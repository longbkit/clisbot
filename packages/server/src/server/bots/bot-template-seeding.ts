// Markdown templates from clisbot main (21baca297), copied into dist by the server
// build (`build:lib` in package.json). BOOTSTRAP.md uses a Fusion-specific timezone
// instruction. Refresh the hash checks in the test when syncing the catalog.
// Moved from the CLI (docs/features/bots-and-chats/README.md, D11): seeding runs on the
// Host, so a bot can be created from any client.
import { readFileSync, readdirSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { BotKind } from "@getpaseo/protocol/bots/types";

export interface BotTemplateSeedResult {
  directory: string;
  created: string[];
  skipped: string[];
  overwritten?: string[];
  backupDirectory?: string;
}

const BOOTSTRAP_CONTEXT_FILES = [
  "AGENTS.md",
  "IDENTITY.md",
  "MEMORY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
] as const;

/** The catalog id recorded on the bot; the only catalog today is per kind. */
export function botTemplateId(kind: BotKind): string {
  return `${kind}-assistant`;
}

export function botTemplate(kind: BotKind): Readonly<Record<string, string>> {
  const files: Record<string, string> = {};
  const layers = ["default", "customized/default", `customized/${kind}-assistant`];
  for (const layer of layers) {
    const directory = new URL(`./templates/${layer}/`, import.meta.url);
    for (const name of readdirSync(directory)
      .filter((entry) => entry.endsWith(".md"))
      .sort()) {
      files[name] = readFileSync(new URL(name, directory), "utf8");
    }
  }
  return files;
}

/** Existing content is preserved unless overwrite is explicit; symlinks are never followed. */
export async function seedBotTemplate(
  directory: string,
  kind: BotKind,
  overwrite = false,
  provider = "codex",
): Promise<BotTemplateSeedResult> {
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  if (root === (await realpath(homedir()))) {
    throw new Error(
      "Choose a workspace inside your home; assistant templates cannot be seeded into the home root.",
    );
  }
  const result: BotTemplateSeedResult = { directory: root, created: [], skipped: [] };
  // clisbot main deletes BOOTSTRAP.md after the first conversation. Treat its
  // absence as completion only when the other core context files are present;
  // an existing repo's AGENTS.md alone is not evidence of prior onboarding.
  const bootstrapCompleted =
    !overwrite &&
    !(await pathExists(path.join(root, "BOOTSTRAP.md"))) &&
    (
      await Promise.all(BOOTSTRAP_CONTEXT_FILES.map((name) => pathExists(path.join(root, name))))
    ).every(Boolean);
  for (const [name, content] of Object.entries(botTemplate(kind))) {
    if (name === "BOOTSTRAP.md" && bootstrapCompleted) continue;
    await seedTemplateFile(result, name, content, overwrite);
  }
  let discoveryFile: string | undefined;
  if (provider === "claude") discoveryFile = "CLAUDE.md";
  else if (provider === "gemini") discoveryFile = "GEMINI.md";
  if (discoveryFile) await seedTemplateLink(result, discoveryFile, overwrite);
  return result;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function seedTemplateLink(result: BotTemplateSeedResult, name: string, overwrite: boolean) {
  const target = path.join(result.directory, name);
  try {
    await symlink("AGENTS.md", target);
    result.created.push(name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!overwrite || !(await lstat(target)).isFile()) {
      result.skipped.push(name);
      return;
    }
    result.backupDirectory ??= await mkdtemp(
      path.join(result.directory, ".clisbot-template-backup-"),
    );
    const original = path.join(result.backupDirectory, name);
    await rename(target, original);
    try {
      await symlink("AGENTS.md", target);
    } catch (linkError) {
      await rename(original, target);
      throw linkError;
    }
    (result.overwritten ??= []).push(name);
  }
}

async function seedTemplateFile(
  result: BotTemplateSeedResult,
  name: string,
  content: string,
  overwrite: boolean,
) {
  const target = path.join(result.directory, name);
  let file;
  try {
    file = await open(target, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!overwrite || !(await lstat(target)).isFile()) {
      result.skipped.push(name);
      return;
    }
    result.backupDirectory ??= await mkdtemp(
      path.join(result.directory, ".clisbot-template-backup-"),
    );
    await replaceTemplateFile(target, name, content, result.backupDirectory);
    (result.overwritten ??= []).push(name);
    return;
  }
  try {
    await file.writeFile(content, "utf8");
    result.created.push(name);
  } finally {
    await file.close();
  }
}

/** Stage first, retain the original entry, then atomically install the new file. */
async function replaceTemplateFile(target: string, name: string, content: string, backup: string) {
  const original = path.join(backup, name);
  const staged = path.join(backup, `.new-${name}`);
  await writeFile(staged, content, { flag: "wx", mode: 0o600 });
  try {
    await rename(target, original);
    try {
      await rename(staged, target);
    } catch (error) {
      await rename(original, target);
      throw error;
    }
  } finally {
    await rm(staged, { force: true });
  }
}

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
import type { BotKind } from "@clisbot/protocol/bots/types";

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

/** `true` replaces every existing file; a list replaces only the names in it. */
export type BotTemplateOverwrite = boolean | readonly string[];

function replaces(overwrite: BotTemplateOverwrite, name: string): boolean {
  return overwrite === true || (Array.isArray(overwrite) && overwrite.includes(name));
}

/** The discovery link a provider reads instead of AGENTS.md, if any. */
function discoveryFileFor(provider: string): string | undefined {
  if (provider === "claude") return "CLAUDE.md";
  if (provider === "gemini") return "GEMINI.md";
  return undefined;
}

export interface BotTemplatePreviewFile {
  name: string;
  exists: boolean;
  /** Only a regular file can be replaced; a link or a folder by that name is always kept. */
  replaceable: boolean;
}

/**
 * What seeding would write into `directory`, and which of those names are already there, under
 * the same rules seeding follows. Reads only; a missing directory has nothing in it yet.
 */
export async function previewBotTemplate(
  directory: string,
  kind: BotKind,
  provider = "codex",
): Promise<BotTemplatePreviewFile[]> {
  const bootstrapDone = await bootstrapCompleted(directory);
  const names = Object.keys(botTemplate(kind)).filter(
    (name) => !(name === "BOOTSTRAP.md" && bootstrapDone),
  );
  const discovery = discoveryFileFor(provider);
  // The link points at AGENTS.md; with AGENTS.md itself a link it is never made (see seeding).
  if (discovery && (await agentsIsRegularOrMissing(directory))) names.push(discovery);
  return Promise.all(
    names.map(async (name) => {
      const entry = await lstatOrNull(path.join(directory, name));
      return { name, exists: entry !== null, replaceable: entry?.isFile() ?? false };
    }),
  );
}

async function lstatOrNull(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * `CLAUDE.md -> AGENTS.md` is only safe when AGENTS.md is a real file. Many repos already link
 * the other way (`AGENTS.md -> CLAUDE.md`); replacing CLAUDE.md there would make a loop.
 */
async function agentsIsRegularOrMissing(directory: string): Promise<boolean> {
  const agents = await lstatOrNull(path.join(directory, "AGENTS.md"));
  return agents === null || agents.isFile();
}

// clisbot main deletes BOOTSTRAP.md after the first conversation. Treat its absence as completion
// only when the other core context files are present; an existing repo's AGENTS.md alone is not
// evidence of prior onboarding.
async function bootstrapCompleted(directory: string): Promise<boolean> {
  if (await pathExists(path.join(directory, "BOOTSTRAP.md"))) return false;
  const present = await Promise.all(
    BOOTSTRAP_CONTEXT_FILES.map((name) => pathExists(path.join(directory, name))),
  );
  return present.every(Boolean);
}

/** Puts back the files a failed creation replaced, from the backup it made. */
export async function restoreReplacedFiles(result: BotTemplateSeedResult): Promise<void> {
  if (!result.backupDirectory || !result.overwritten?.length) return;
  for (const name of result.overwritten) {
    const target = path.join(result.directory, name);
    await rm(target, { force: true });
    await rename(path.join(result.backupDirectory, name), target);
  }
  await rm(result.backupDirectory, { recursive: true, force: true });
}

/** Existing content is preserved unless overwrite is explicit; symlinks are never followed. */
export async function seedBotTemplate(
  directory: string,
  kind: BotKind,
  overwrite: BotTemplateOverwrite = false,
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
  const skipBootstrap = !replaces(overwrite, "BOOTSTRAP.md") && (await bootstrapCompleted(root));
  for (const [name, content] of Object.entries(botTemplate(kind))) {
    if (name === "BOOTSTRAP.md" && skipBootstrap) continue;
    await seedTemplateFile(result, name, content, replaces(overwrite, name));
  }
  const discoveryFile = discoveryFileFor(provider);
  if (discoveryFile) {
    if (await agentsIsRegularOrMissing(root)) {
      await seedTemplateLink(result, discoveryFile, replaces(overwrite, discoveryFile));
    } else {
      result.skipped.push(discoveryFile);
    }
  }
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

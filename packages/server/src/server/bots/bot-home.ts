import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BotErrorCode } from "@clisbot/protocol/bots/types";
import { expandTilde } from "../../utils/path.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import { uniqueBotSlug } from "./bot-slug.js";

/**
 * Where a bot lives (docs/features/bots-and-chats/README.md, D3): an explicit path
 * wins, otherwise `<root>/<slug>`. The OS home root is refused, and so is a home
 * strictly inside or strictly containing an active Project: a nested Project would
 * block every later bot for restricted sessions and break per-bot sharing (D4, D13).
 */
export class BotHomeError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotHomeError";
  }
}

export interface BotHome {
  cwd: string;
  slug: string;
  explicit: boolean;
}

export interface ResolveBotHomeInput {
  name: string;
  path?: string;
  root: string;
  /** Slugs already recorded, archived included. */
  takenSlugs: ReadonlySet<string>;
}

export async function resolveBotHome(input: ResolveBotHomeInput): Promise<BotHome> {
  const explicit = input.path?.trim();
  if (explicit) {
    const cwd = path.resolve(expandTilde(explicit));
    if ((await canonicalOrSelf(cwd)) === (await canonicalOrSelf(input.root))) {
      throw new BotHomeError("inside_project", "The bots root cannot itself be a bot home.");
    }
    return { cwd, slug: path.basename(cwd), explicit: true };
  }
  const slug = await uniqueBotSlug(input.name, input.takenSlugs, (candidate) =>
    directoryExists(path.join(input.root, candidate)),
  );
  return { cwd: path.join(input.root, slug), slug, explicit: false };
}

/** Throws `home_root` or `inside_project`; a home equal to a Project root is allowed (reuse). */
export async function assertBotHomeAllowed(
  cwd: string,
  activeProjectRoots: readonly string[],
): Promise<void> {
  const canonical = await canonicalOrSelf(cwd);
  if (canonical === (await canonicalOrSelf(homedir()))) {
    throw new BotHomeError("home_root", "A bot cannot live in your home directory itself.");
  }
  for (const root of activeProjectRoots) {
    const canonicalRoot = await canonicalOrSelf(root);
    if (canonicalRoot === canonical) continue;
    if (isSameOrDescendantPath(canonicalRoot, canonical)) {
      throw new BotHomeError("inside_project", `${cwd} is inside the Project at ${root}.`);
    }
    if (isSameOrDescendantPath(canonical, canonicalRoot)) {
      throw new BotHomeError("inside_project", `${cwd} contains the Project at ${root}.`);
    }
  }
}

/** The real path of `target`, or of its nearest existing ancestor with the missing tail appended. */
async function canonicalOrSelf(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const missing: string[] = [];
  let current = resolved;
  while (true) {
    try {
      return path.join(await realpath(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

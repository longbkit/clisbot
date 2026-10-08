import type { BotKind } from "../data/contracts";

/**
 * Which template a new bot starts from, and what happens to files the folder already has
 * (docs/features/bots-and-chats/README.md, D11). A bot made from a Project starts with none,
 * from what the Project holds; a new bot starts with Personal, since its folder is empty.
 */
export type BotTemplateChoice = "none" | BotKind;

/** Files that already exist: keep them all, replace them all, or decide one by one. */
export type BotTemplateConflictPolicy = "keep" | "replace" | "choose";

export interface BotTemplateFile {
  name: string;
  exists: boolean;
  /** A link or folder by that name is always kept; older Hosts omit this. */
  replaceable?: boolean;
}

export interface BotTemplateState {
  choice: BotTemplateChoice;
  /** What the template would write into the bot's folder; null until the Host answers. */
  files: BotTemplateFile[] | null;
  policy: BotTemplateConflictPolicy;
  /** With `choose`, the existing files the template replaces. */
  replace: string[];
}

export function initialTemplateState(choice: BotTemplateChoice): BotTemplateState {
  return { choice, files: null, policy: "keep", replace: [] };
}

/** Files the template would write that the folder already has as a file it can replace. */
export function templateConflicts(template: BotTemplateState): string[] {
  return (template.files ?? [])
    .filter((file) => file.exists && file.replaceable !== false)
    .map((file) => file.name);
}

/** A bot from a Project waits for the preview, so nothing it did not show is replaced. */
export function awaitingTemplatePreview(template: BotTemplateState, fromProject: boolean): boolean {
  return fromProject && template.choice !== "none" && template.files === null;
}

/** The `template` of `bot.create`. Replaced files move into a backup folder on the Host first. */
export function templateRequest(
  template: BotTemplateState,
): { seed: false } | { overwrite: boolean | string[] } | undefined {
  if (template.choice === "none") return { seed: false };
  // Named files only: `true` would also replace files the preview never listed.
  const replace = template.policy === "replace" ? templateConflicts(template) : template.replace;
  if (template.policy !== "keep" && replace.length > 0) return { overwrite: replace };
  return undefined;
}

export function toggledReplace(template: BotTemplateState, name: string): BotTemplateState {
  const replace = template.replace.includes(name)
    ? template.replace.filter((entry) => entry !== name)
    : [...template.replace, name];
  return { ...template, replace };
}

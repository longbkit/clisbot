import { pathBaseName } from "@/add-project-flow/options";

/**
 * The browser has one input. Text up to the last separator is the folder being listed,
 * the rest filters its subfolders: `~/dev/cli` lists `~/dev/` filtered by `cli`.
 */
export interface BrowseInput {
  directory: string;
  filter: string;
}

const TRAILING_SEPARATORS = /[\\/]+$/u;

function lastSeparatorIndex(value: string): number {
  return Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
}

function separatorOf(value: string): "/" | "\\" {
  return value.includes("\\") && !value.includes("/") ? "\\" : "/";
}

export function splitBrowseInput(input: string): BrowseInput {
  const value = input.trim();
  if (value === "" || value === "~") return { directory: "~", filter: "" };
  const index = lastSeparatorIndex(value);
  if (index < 0) return { directory: "~", filter: value };
  return { directory: value.slice(0, index + 1), filter: value.slice(index + 1) };
}

/** The input that lists `path` itself: `~` → `~/`, `/srv/app` → `/srv/app/`. */
export function browseInputFor(path: string): string {
  const value = path.trim() || "~";
  return TRAILING_SEPARATORS.test(value) ? value : `${value}${separatorOf(value)}`;
}

export function childBrowseInput(directory: string, path: string): string {
  return browseInputFor(`${browseInputFor(directory)}${pathBaseName(path)}`);
}

/**
 * Up one level from a folder input. `hostParentPath` is the Host's answer for the listed
 * folder; null means a root or a parent the Host does not let this user browse.
 */
export function parentBrowseInput(input: string, hostParentPath: string | null): string | null {
  const { directory, filter } = splitBrowseInput(input);
  if (filter || !hostParentPath) return null;
  const trimmed = directory.replace(TRAILING_SEPARATORS, "");
  const index = lastSeparatorIndex(trimmed);
  if (trimmed === "~" || index < 0) return browseInputFor(hostParentPath);
  return trimmed.slice(0, index + 1);
}

/** Exact name first, then names starting with the filter, then the rest in Host order. */
export function rankBrowseEntries<T extends { path: string }>(entries: T[], filter: string): T[] {
  const needle = filter.toLowerCase();
  if (!needle) return entries;
  const rank = (entry: T) => {
    const name = pathBaseName(entry.path).toLowerCase();
    if (name === needle) return 0;
    return name.startsWith(needle) ? 1 : 2;
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

export function exactBrowseEntry<T extends { path: string }>(
  entries: T[],
  filter: string,
): T | null {
  const needle = filter.toLowerCase();
  if (!needle) return null;
  return entries.find((entry) => pathBaseName(entry.path).toLowerCase() === needle) ?? null;
}

export function browseErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return "Folder not found";
  if (message.includes("ENOTDIR")) return "Not a folder";
  if (message.includes("EACCES") || message.includes("EPERM")) return "Permission denied";
  return message;
}

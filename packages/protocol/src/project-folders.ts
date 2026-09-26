// Clisbot Managed Access: where a Project may be created on a Host.
// docs/features/access/terminal-and-project-creation.md#project-creation
//
// Pure path-pattern matching shared by the Hub (validating grant rules), the
// daemon (enforcement), and the app. Callers pass canonical absolute paths; the
// daemon resolves symlinks before asking. Windows paths are compared with `/`
// separators and without case.

/** One allow/deny pair: a Host policy's, or a grant's narrowing. */
export interface ProjectFolderRules {
  allow: readonly string[];
  deny: readonly string[];
}

/** The Host policy a daemon applies when the environment sets none. */
export const DEFAULT_PROJECT_FOLDER_POLICY: ProjectFolderRules = {
  allow: ["**"],
  deny: ["/", "~", "~/.ssh/**", "/etc/**"],
};

/**
 * A pattern the matcher can decide safely: `**`, or an absolute path (`/…`,
 * `C:/…`, `~`, `~/…`) with no `.` or `..` segment. Relative segments would let
 * a delegated rule read as inside the grantor's folder and resolve outside it.
 */
export function isValidFolderPattern(pattern: string): boolean {
  const value = toSlashes(pattern.trim());
  if (value === "**") return true;
  if (!(value === "~" || value.startsWith("~/") || isAbsolutePath(value))) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

/** `~` or `~/…` expanded to `home`; anything else unchanged. Separators become `/`. */
export function expandHomePath(value: string, home: string): string {
  const slashed = toSlashes(value.trim());
  const homeSlashed = stripTrailingSlash(toSlashes(home));
  if (slashed === "~") return homeSlashed;
  return slashed.startsWith("~/") ? `${homeSlashed}${slashed.slice(1)}` : slashed;
}

/**
 * Whether `path` matches `pattern`. `*` matches one path segment, `**` any
 * number of segments, zero included (`/workspace/**` matches `/workspace`). A
 * bare `**` matches every path; an invalid pattern matches none.
 */
export function matchesFolderPattern(path: string, pattern: string, home: string): boolean {
  if (!isValidFolderPattern(pattern)) return false;
  const expanded = expandHomePath(pattern, home);
  if (expanded === "**") return true;
  const target = stripTrailingSlash(toSlashes(path));
  const flags = isWindowsPath(target) || isWindowsPath(expanded) ? "i" : "";
  return patternToRegExp(stripTrailingSlash(expanded), flags).test(target);
}

/**
 * Allowed when some allow pattern matches, no deny pattern does, and no deny
 * pattern lies inside the path: a Project at `/Users` would contain `~/.ssh`.
 * An invalid deny pattern denies everything, so a typo cannot open a Host.
 */
export function folderRulesAllow(rules: ProjectFolderRules, path: string, home: string): boolean {
  if (rules.deny.some((pattern) => !isValidFolderPattern(pattern))) return false;
  if (rules.deny.some((pattern) => matchesFolderPattern(path, pattern, home))) return false;
  if (rules.deny.some((pattern) => containsPattern(path, pattern, home))) return false;
  return rules.allow.some((pattern) => matchesFolderPattern(path, pattern, home));
}

/** The part of a pattern before its first wildcard segment, or null for `**`. */
export function folderPatternLiteralPrefix(pattern: string, home: string): string | null {
  const segments = expandHomePath(pattern, home).split("/");
  const firstWildcard = segments.findIndex((segment) => segment.includes("*"));
  const prefix = segments.slice(0, firstWildcard === -1 ? undefined : firstWildcard).join("/");
  if (prefix === "") return segments[0] === "" && firstWildcard !== 0 ? "/" : null;
  return prefix;
}

/** Splits a comma- or newline-separated list of patterns, dropping blanks. */
export function parseFolderPatterns(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

/**
 * Whether folders a deny pattern names lie strictly inside `path`: its literal
 * prefix is below `path`, or is `path` itself with a wildcard part still to come
 * (`/workspace` contains what `/workspace/prod-*` names).
 */
function containsPattern(path: string, pattern: string, home: string): boolean {
  const prefix = folderPatternLiteralPrefix(pattern, home);
  if (prefix === null) return false;
  const parent = stripTrailingSlash(toSlashes(path));
  const child = stripTrailingSlash(prefix);
  const caseless = isWindowsPath(parent) || isWindowsPath(child);
  const [a, b] = caseless ? [parent.toLowerCase(), child.toLowerCase()] : [parent, child];
  if (a === b) return stripTrailingSlash(expandHomePath(pattern, home)) !== child;
  return b.startsWith(a === "/" ? "/" : `${a}/`);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsPath(value);
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || /^[A-Za-z]:$/.test(value);
}

function toSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith("/") && !/^[A-Za-z]:\/$/.test(value)
    ? value.slice(0, -1)
    : value;
}

function patternToRegExp(pattern: string, flags: string): RegExp {
  const segments = pattern.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    if (index === 0 && segment === "") return;
    const separator = index === 0 ? "" : "/";
    if (segment === "**") {
      // Zero or more whole segments, so `/a/**` also matches `/a`.
      source += "(?:/[^/]+)*";
      return;
    }
    source += `${separator}${segment.split("*").map(escapeRegExp).join("[^/]*")}`;
  });
  return new RegExp(`^${source === "" ? "/" : source}$`, flags);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

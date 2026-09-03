import { homedir } from "node:os";
import { isAbsolute, posix, resolve, win32 } from "node:path";

export function assertAbsolutePath(cwd: string): void {
  if (!posix.isAbsolute(cwd) && !win32.isAbsolute(cwd)) {
    throw new Error("cwd must be absolute path");
  }
}

function hasHomePrefix(value: string): boolean {
  return value === "~" || value.startsWith("~/");
}

export function expandUserPath(value: string): string {
  const trimmed = value.trim();
  if (hasHomePrefix(trimmed)) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

export function resolvePathFromBase(baseCwd: string, requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (hasHomePrefix(trimmed) || isAbsolute(trimmed)) {
    return expandUserPath(trimmed);
  }
  return resolve(baseCwd, trimmed);
}

export function isSameOrDescendantPath(basePath: string, candidatePath: string): boolean {
  const compareAsWindows = looksLikeWindowsPath(basePath) || looksLikeWindowsPath(candidatePath);
  const normalizedBase = normalizeContainmentPath(basePath, compareAsWindows);
  const normalizedCandidate = normalizeContainmentPath(candidatePath, compareAsWindows);
  const boundary = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;

  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(boundary);
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(value);
}

function normalizeContainmentPath(value: string, compareAsWindows: boolean): string {
  const normalized = compareAsWindows
    ? win32.normalize(value)
    : posix.normalize(value.replace(/\\/g, "/"));
  const comparable = normalized.replace(/\\/g, "/");
  return compareAsWindows ? comparable.toLowerCase() : comparable;
}

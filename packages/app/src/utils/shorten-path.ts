/**
 * Shortens a file path by replacing the home directory prefix with ~.
 * Handles both macOS (/Users/username) and Linux (/home/username) paths.
 */
export function shortenPath(path: string | undefined | null): string {
  if (!path) {
    return "";
  }
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/**
 * A path for reading, not copying: home shortened to `~` and a zero-width space after every
 * separator, so a long path wraps at a folder boundary instead of overflowing or cutting a name.
 */
export function wrappablePath(path: string | undefined | null): string {
  return shortenPath(path).replace(/([/\\])/g, "$1​");
}

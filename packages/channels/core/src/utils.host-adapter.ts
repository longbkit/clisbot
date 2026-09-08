// Fusion-owned host adapter for the `src/utils.ts` barrel (D-CORE-061).
//
// Upstream's barrel is OpenClaw's general utility grab bag (config paths, home
// directory resolution, process helpers). The ported media path reads one helper:
// expanding a leading `~` against the user's home directory.
import os from "node:os";
import path from "node:path";

/** Expands a leading `~` to the user's home directory. */
export function resolveUserPath(target: string): string {
  const trimmed = target.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  return trimmed.startsWith("~/")
    ? path.join(os.homedir(), trimmed.slice(2))
    : path.resolve(trimmed);
}

// Fusion-owned host adapter for the `src/utils.ts` barrel (D-CORE-061).
//
// Upstream's barrel is OpenClaw's general utility grab bag (config paths, home
// directory resolution, process helpers). The ported media path reads one helper:
// expanding a leading `~` against the user's home directory. The WhatsApp port
// reads four more, carried with upstream's bodies: `ensureDir`, `clampNumber` /
// `clamp`, and `normalizeE164` (the loose E.164 shape every WhatsApp target is
// folded to). OpenClaw's config/state directory accessors stay omitted; the Hub
// owns where state lives.
import fs from "node:fs";
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

/** Creates a directory tree if it does not already exist. */
export async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/** Clamps a number to an inclusive min/max range. */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Alias for clampNumber (shorter, more common name) */
export const clamp = clampNumber;

/** Normalizes phone-like input into the loose E.164 shape used by channel helpers. */
export function normalizeE164(number: string): string {
  const withoutPrefix = number.replace(/^[a-z][a-z0-9-]*:/i, "").trim();
  const digits = withoutPrefix.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

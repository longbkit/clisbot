import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, resolve, join } from "node:path";

export function localControlCredentialPath(dataDirectory: string): string {
  const directory = resolve(dataDirectory);
  if (dirname(directory) === directory)
    throw new Error("Data directory must not be the filesystem root");
  return join(dirname(directory), `.${basename(directory)}-device-operator`);
}

export function loadOrCreateLocalControlCredential(path: string): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    return readLocalControlCredential(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("base64url");
  try {
    writeFileSync(path, `${token}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readLocalControlCredential(path);
}

export function readLocalControlCredential(path: string): string {
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Malformed local operator credential");
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return token;
}

export function matchesLocalControlCredential(
  expected: string | undefined,
  authorization: string | null,
): boolean {
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(authorization.slice(7));
  const reference = Buffer.from(expected);
  return candidate.length === reference.length && timingSafeEqual(candidate, reference);
}

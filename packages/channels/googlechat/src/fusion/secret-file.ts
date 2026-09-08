// Fusion-owned boundary for `openclaw/plugin-sdk/secret-file-runtime` (D-GC-006).
//
// Upstream's `tryReadSecretFileSync` sits on the `@openclaw/fs-safe` workspace
// package: it opens the path with O_NOFOLLOW, refuses hardlinks and group/other
// permissions, tightens the parent directory chain and reports a structured
// `FsSafeError` code. Fusion's Hub owns credentials and never depends on an
// OpenClaw workspace package, so this module keeps the call shape the ported
// `accounts.ts` uses — `(path, label, {maxBytes,…}, {configPath})` in, a
// `{status, value}` / `{status, diagnostic}` result out — over `node:fs` with
// the size cap and the regular-file check. The symlink/hardlink/permission
// hardening is NOT carried; the Hub is the credential authority and the path
// comes from an operator-authored account config, not from channel traffic.
import { openSync, closeSync, fstatSync, readFileSync } from "node:fs";

/** Upstream `CredentialFileUnavailableDiagnostic`. */
export interface SecretFileDiagnostic {
  code: "CREDENTIAL_FILE_UNAVAILABLE";
  /** The config path that named the file (never the filesystem path). */
  path: string;
  /** Machine-readable cause (`ENOENT`, `NOT_A_FILE`, `TOO_LARGE`, …). */
  reason: string;
}

export type SecretFileReadResult =
  | { status: "available"; value: string }
  | { status: "missing"; diagnostic?: undefined }
  | { status: "configured_unavailable"; diagnostic: SecretFileDiagnostic };

export interface SecretFileReadOptions {
  maxBytes?: number;
  rejectHardlinks?: boolean;
  rejectSymlink?: boolean;
}

/** Reads an explicitly configured credential file without exposing its path. */
export function tryReadSecretFileSync(
  filePath: string | undefined,
  label: string,
  options: SecretFileReadOptions | undefined,
  diagnostic: { configPath: string },
): SecretFileReadResult {
  if (filePath === undefined || filePath.trim() === "") {
    return { status: "missing" };
  }
  const unavailable = (reason: string): SecretFileReadResult => ({
    status: "configured_unavailable",
    diagnostic: { code: "CREDENTIAL_FILE_UNAVAILABLE", path: diagnostic.configPath, reason },
  });
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch (error) {
    return unavailable((error as NodeJS.ErrnoException).code ?? "OPEN_FAILED");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return unavailable("NOT_A_FILE");
    const maxBytes = options?.maxBytes;
    if (maxBytes !== undefined && stat.size > maxBytes) return unavailable("TOO_LARGE");
    const value = readFileSync(fd, "utf8");
    if (maxBytes !== undefined && Buffer.byteLength(value, "utf8") > maxBytes) {
      return unavailable("TOO_LARGE");
    }
    if (value.trim() === "") return unavailable("EMPTY");
    void label;
    return { status: "available", value };
  } catch (error) {
    return unavailable((error as NodeJS.ErrnoException).code ?? "READ_FAILED");
  } finally {
    closeSync(fd);
  }
}

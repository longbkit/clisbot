// Fusion-owned boundary for `openclaw/plugin-sdk/secret-file-runtime` (D-ZL-007).
//
// Upstream's `tryReadSecretFileSync` sits on the `@openclaw/fs-safe` workspace
// package: it opens the path with O_NOFOLLOW, refuses hardlinks and group/other
// permissions, tightens the parent directory chain and reports a structured
// `FsSafeError` code. Fusion's Hub owns credentials and never depends on an
// OpenClaw workspace package, so this module keeps the call shape the ported
// `token.ts` uses — `(path, label, {maxBytes,…}, {configPath})` in, a
// `{status, value}` / `{status, diagnostic}` result out — over `node:fs` with
// the size cap and the regular-file check. The symlink/hardlink/permission
// hardening is NOT carried; the Hub is the credential authority and the path
// comes from an operator-authored account config, not from channel traffic.
import { openSync, closeSync, constants, fstatSync, readFileSync } from "node:fs";

/** Upstream `CredentialFileUnavailableDiagnostic`. */
export interface SecretFileDiagnostic {
  code: "CREDENTIAL_FILE_UNAVAILABLE";
  /** The config path that named the file (never the filesystem path). */
  path: string;
  /** Machine-readable cause, in upstream's `FsSafeErrorCode` vocabulary
   * (`not-found`, `symlink`, `permission`, `not-a-file`, `too-large`, `empty`). */
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

/** Upstream's `ConfiguredCredentialResult`: a path that WAS configured cannot
 * come back "missing", so the caller reads `diagnostic` without narrowing. */
export type ConfiguredSecretFileReadResult = Exclude<SecretFileReadResult, { status: "missing" }>;

/** Reads an explicitly configured credential file without exposing its path. */
export function tryReadSecretFileSync(
  filePath: string,
  label: string,
  options: SecretFileReadOptions | undefined,
  diagnostic: { configPath: string },
): ConfiguredSecretFileReadResult;
export function tryReadSecretFileSync(
  filePath: string | undefined,
  label: string,
  options: SecretFileReadOptions | undefined,
  diagnostic: { configPath: string },
): SecretFileReadResult;
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
    // `O_NOFOLLOW` is upstream's symlink refusal: the open itself fails with
    // ELOOP rather than reading through the link. It is the one piece of the
    // fs-safe hardening this boundary keeps, because a token file is exactly the
    // path an operator is most likely to have symlinked by accident.
    fd = openSync(
      filePath,
      options?.rejectSymlink === false ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    return unavailable(mapErrnoToFsSafeCode((error as NodeJS.ErrnoException).code));
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return unavailable("not-a-file");
    const maxBytes = options?.maxBytes;
    if (maxBytes !== undefined && stat.size > maxBytes) return unavailable("too-large");
    const value = readFileSync(fd, "utf8");
    if (maxBytes !== undefined && Buffer.byteLength(value, "utf8") > maxBytes) {
      return unavailable("too-large");
    }
    if (value.trim() === "") return unavailable("empty");
    void label;
    return { status: "available", value };
  } catch (error) {
    return unavailable(mapErrnoToFsSafeCode((error as NodeJS.ErrnoException).code));
  } finally {
    closeSync(fd);
  }
}

/** node errno → upstream's `FsSafeErrorCode` spelling, so a diagnostic reads the
 * same on both sides (the ported `token.ts` tests assert these strings). */
function mapErrnoToFsSafeCode(code: string | undefined): string {
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
      return "not-found";
    case "ELOOP":
      return "symlink";
    case "EACCES":
    case "EPERM":
      return "permission";
    case "EISDIR":
      return "not-a-file";
    default:
      return code ?? "read-failed";
  }
}

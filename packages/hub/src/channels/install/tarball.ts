// Pure-JS tar extractor for pinned OpenClaw supply. The security boundary is the
// integrity hash (verified on the raw tarball bytes before extraction, plan §14.4);
// extraction is mechanical. npm tarballs are gzip(u) and use the POSIX ustar format
// with pax/GNU extensions, so this reader handles:
//   - regular files (type '0' or '\0'), directories ('5'), symlinks ('2'), hardlinks ('1')
//   - pax extended ('x') and global ('g') headers carrying `path=`/`linkpath=`
//   - GNU long-name ('L') / long-link ('K') headers
//   - the two-zero-block terminator
// Every entry is stripped of its leading `package/` component and confined to the
// target directory (no `..` traversal, absolute paths, or symlink escapes).

import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, normalize, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

/** A resolved tarball entry after the `package/` prefix is stripped. */
export interface TarEntry {
  /** Path relative to the package root (leading `package/` removed, no `..`). */
  path: string;
  kind: "file" | "dir" | "symlink" | "hardlink";
  /** Content for `file`; for `symlink`/`hardlink` the target path. */
  data?: Uint8Array;
  linkTarget?: string;
}

export class TarballError extends Error {
  /** Context field shared with the other install-plane error classes (plan: one
   * domain error shape). Set when the escape is attributed to a channel. */
  readonly channel?: string;
  constructor(message: string, options?: { channel?: string }) {
    super(message);
    this.name = "TarballError";
    if (options?.channel !== undefined) this.channel = options.channel;
  }
}

function readName(data: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && data[end] !== 0) end += 1;
  return Buffer.from(data.subarray(offset, end)).toString("utf8");
}

function readOctal(data: Uint8Array, offset: number, length: number): number {
  const raw = readName(data, offset, length).trim();
  if (raw === "") return 0;
  // ustar size may be high-bit-set octal; strip the leading 0xff padding byte.
  let clean = raw;
  while (clean.length > 0 && clean.charCodeAt(0) === 0xff) clean = clean.slice(1);
  const value = parseInt(clean, 8);
  return Number.isFinite(value) ? value : 0;
}

/** Strip trailing NUL padding from a GNU long-name body. */
function stripTrailingNulls(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0) end -= 1;
  return text.slice(0, end);
}

function readPaxRecord(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  const text = Buffer.from(data).toString("utf8");
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) break;
    const record = text.slice(offset, newline);
    const match = /^(\d+) (\S+)=(.*)$/.exec(record);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      records.set(match[2], match[3]);
    }
    offset = newline + 1;
  }
  return records;
}

/** Long-name headers in flight (pax `path=`/`linkpath=`, GNU `L`/`K`). */
interface PendingHeaders {
  pendingPath?: string | undefined;
  pendingLinkPath?: string | undefined;
}

/** Parse a (possibly gzipped) npm tarball into resolved entries. */
export function parseNpmTarball(buffer: Uint8Array): TarEntry[] {
  const data = gunzipSafe(buffer);
  const entries: TarEntry[] = [];
  const pending: PendingHeaders = {};
  let offset = 0;
  while (offset + 512 <= data.length) {
    if (isZeroBlock(data, offset)) break;
    const header = data.subarray(offset, offset + 512);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const size = readOctal(header, 124, 12);
    const blockEnd = offset + 512 + size + ((512 - (size % 512)) % 512);
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (applyExtensionHeader(typeFlag, body, pending)) {
      offset = blockEnd;
      continue;
    }
    const entry = entryForHeader(typeFlag, header, body, pending);
    if (entry !== undefined) entries.push(entry);
    offset = blockEnd;
  }
  return entries;
}

/** pax ('x'/'g') and GNU long-name ('L'/'K') headers are consumed, not entries. */
function applyExtensionHeader(
  typeFlag: string,
  body: Uint8Array,
  pending: PendingHeaders,
): boolean {
  if (typeFlag === "x" || typeFlag === "g") {
    const pax = readPaxRecord(body);
    const path = pax.get("path");
    const linkpath = pax.get("linkpath");
    if (path !== undefined) pending.pendingPath = path;
    if (linkpath !== undefined) pending.pendingLinkPath = linkpath;
    return true;
  }
  if (typeFlag === "L") {
    pending.pendingPath = stripTrailingNulls(Buffer.from(body).toString("utf8"));
    return true;
  }
  if (typeFlag === "K") {
    pending.pendingLinkPath = stripTrailingNulls(Buffer.from(body).toString("utf8"));
    return true;
  }
  return false;
}

/** Resolve one regular/dir/symlink/hardlink header to an entry (undefined for
 * type flags that do not produce an entry). */
function entryForHeader(
  typeFlag: string,
  header: Uint8Array,
  body: Uint8Array,
  pending: PendingHeaders,
): TarEntry | undefined {
  let name = readName(header, 0, 100);
  if (pending.pendingPath !== undefined) {
    name = pending.pendingPath;
    pending.pendingPath = undefined;
  }
  let linkTarget = readName(header, 157, 100);
  if (pending.pendingLinkPath !== undefined) {
    linkTarget = pending.pendingLinkPath;
    pending.pendingLinkPath = undefined;
  }
  // ustar split long names across prefix (345) + name (0).
  const prefix = readName(header, 345, 155);
  if (prefix !== "" && !name.startsWith(prefix + "/")) {
    name = `${prefix}/${name}`;
  }
  const stripped = stripPackagePrefix(name);
  if (stripped === undefined || stripped === "") return undefined;
  if (typeFlag === "5") return { path: stripped, kind: "dir" };
  if (typeFlag === "2") return { path: stripped, kind: "symlink", linkTarget };
  if (typeFlag === "1") {
    return {
      path: stripped,
      kind: "hardlink",
      linkTarget: stripPackagePrefix(linkTarget) ?? linkTarget,
    };
  }
  if (typeFlag === "0" || typeFlag.charCodeAt(0) === 0) {
    return { path: stripped, kind: "file", data: body };
  }
  return undefined;
}

function gunzipSafe(buffer: Uint8Array): Uint8Array {
  const head = buffer.subarray(0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    return new Uint8Array(gunzipSync(Buffer.from(buffer)));
  }
  return buffer;
}

function isZeroBlock(data: Uint8Array, offset: number): boolean {
  for (let i = 0; i < 512; i += 1) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

/** Remove the leading `package/` component npm adds; reject traversal/absolute. */
function stripPackagePrefix(name: string): string | undefined {
  const normalized = name.replace(/\\/gu, "/");
  const parts = normalized.split("/");
  const body = parts[0] === "package" ? parts.slice(1) : parts;
  if (body.some((p) => p === "..")) return undefined;
  const joined = body.join("/");
  if (joined.startsWith("/") || joined === "") return undefined;
  return normalize(joined);
}

/** Extract entries into `targetDir` (created if missing). Purely mechanical — the
 * integrity check already proved the bytes are the pinned supply. */
export function extractNpmTarball(buffer: Uint8Array, targetDir: string): void {
  const entries = parseNpmTarball(buffer);
  const root = resolve(targetDir);
  for (const entry of entries) {
    const dest = resolveSafe(root, entry.path);
    if (entry.kind === "dir") {
      mkdirSync(dest, { recursive: true });
    } else if (entry.kind === "file") {
      mkdirSync(dirname(dest), { recursive: true });
      if (entry.data !== undefined) writeFileSync(dest, entry.data);
    } else if (entry.kind === "symlink" || entry.kind === "hardlink") {
      mkdirSync(dirname(dest), { recursive: true });
      if (existsSync(dest)) continue;
      symlinkSync(
        resolveSafe(root, entry.linkTarget ?? ""),
        dest,
        entry.kind === "symlink" ? "file" : "junction",
      );
    }
  }
}

function resolveSafe(root: string, relative: string): string {
  const cleaned = relative.replace(/\\/gu, "/");
  if (cleaned.startsWith("/") || cleaned.split("/").includes("..")) {
    throw new TarballError(`tarball entry escapes the install dir: ${relative}`);
  }
  const full = resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new TarballError(`tarball entry escapes the install dir: ${relative}`);
  }
  return full;
}

/** Read a file straight out of a tarball buffer (no extraction to disk). */
export function readTarballFile(buffer: Uint8Array, path: string): string | undefined {
  for (const entry of parseNpmTarball(buffer)) {
    if (entry.path === path && entry.kind === "file" && entry.data !== undefined) {
      return Buffer.from(entry.data).toString("utf8");
    }
  }
  return undefined;
}

/** The directory names present at the top level of the installed package's
 * `node_modules` (for THIRD_PARTY_NOTICES / load-trace allowlisting). */
export function listTarballNodeModules(buffer: Uint8Array): string[] {
  const seen = new Set<string>();
  for (const entry of parseNpmTarball(buffer)) {
    const m = /^node_modules\/(@[^/]+\/[^/]+|[^/]+)/.exec(entry.path);
    if (m?.[1] !== undefined) seen.add(m[1]);
  }
  return [...seen].sort();
}

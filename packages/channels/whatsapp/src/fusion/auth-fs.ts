// Fusion-owned linked-device auth storage (D-WA-010).
//
// Baileys' auth state is a directory: `creds.json` (the device identity and
// the noise/signal keys that ARE the linked account), its `creds.json.bak`, and
// one file per Signal key (`pre-key-*`, `session-*`, `sender-key-*`,
// `app-state-sync-key-*`, `lid-mapping-*`, …). Upstream keeps that directory on
// disk under OpenClaw's OAuth dir and reaches it through `node:fs`,
// `useMultiFileAuthState` and the fs-safe helpers in `creds-files.ts`,
// `creds-persistence.ts` and `auth-store.ts`.
//
// Those bytes are a complete, replayable credential for a human's WhatsApp
// account, so the Hub rule for QR-login sessions applies: native storage
// semantics, encrypted at rest (runtime strategy §0.1 note 7). This module keeps
// the DIRECTORY semantics — the same file names, the same backup/restore and
// logout flow upstream wrote against — and moves the bytes into the account's
// keyed-store namespace `auth`, which the Hub backs with its encrypted state
// (`packages/hub/src/channels/state/encrypted-namespaces.ts`). The ported files
// change only an import specifier; nothing here reads or writes the real disk.
//
// Paths. Every account's auth directory is a virtual path under
// `WHATSAPP_AUTH_ROOT` (`fusion/state-paths.ts` hands that root to upstream's
// `resolveOAuthDir`). A path outside the root reads as missing and refuses
// writes, so no code path can fall back to plaintext files.
//
// Writes. A Signal key changes on almost every message, and the Hub's encrypted
// backing rewrites the whole namespace per mutation. Writes therefore land in
// memory at once and are persisted together after a short coalescing window;
// every awaited write resolves only once the snapshot that contains it is
// durable, and a failed persist rejects the writers waiting on it (upstream's
// creds-persistence failure path then aborts the socket).
//
// Storage format. The snapshot is stored as parts under a header that moves
// last (`fusion/auth-snapshot.ts`), because the Hub caps one value at 64KB.
import path from "node:path";
import type { HostRuntime } from "@clisbot/channels-shared";
import { normalizeAccountId } from "@clisbot/channels-core/plugin-sdk/account-core";
import {
  loadAuthSnapshot,
  saveAuthSnapshot,
  sweepStaleAuthParts,
  WHATSAPP_AUTH_MAX_ENTRIES,
  type AuthDirHeader,
  type AuthFile,
  type AuthStore,
  type StoredAuthDir,
} from "./auth-snapshot.js";

/** The account's keyed-store namespace; the Hub encrypts it. */
export const WHATSAPP_AUTH_NAMESPACE = "auth";
/** Coalescing window for auth writes. */
export const WHATSAPP_AUTH_FLUSH_DELAY_MS = 25;

/** Virtual root standing in for upstream's OpenClaw OAuth directory. */
export const WHATSAPP_AUTH_ROOT = path.join(
  path.parse(process.cwd()).root,
  "__clisbot_encrypted_channel_state__",
  "oauth",
);

interface BoundAuthDir {
  accountId: string;
  authDir: string;
  store: AuthStore;
  files: Map<string, AuthFile>;
  /** The generation the header points at; undefined until the first persist. */
  header?: AuthDirHeader;
  chain: Promise<void>;
  scheduled?: Promise<void>;
}

const boundByDir = new Map<string, BoundAuthDir>();
/** Unbinds still flushing, by directory: a rebind waits so it reads what they wrote. */
const closingByDir = new Map<string, Promise<void>>();

/** The virtual auth directory of one account (upstream's default layout). */
export function whatsAppAuthDirFor(accountId: string): string {
  return path.join(WHATSAPP_AUTH_ROOT, "whatsapp", normalizeAccountId(accountId));
}

function openAuthStore(hostRuntime: HostRuntime): AuthStore {
  return hostRuntime.state.openKeyedStore({
    namespace: WHATSAPP_AUTH_NAMESPACE,
    maxEntries: WHATSAPP_AUTH_MAX_ENTRIES,
    overflowPolicy: "reject-new",
  }) as AuthStore;
}

/**
 * Binds an account's auth directory to its keyed store and loads it. Binding an
 * account that is already bound keeps the live copy: the QR screen binds while
 * the account may be running, and reloading then would replace in-memory keys
 * with the last persisted snapshot. A stopped account is unbound, so its next
 * bind (a relink, a restart) reads the store afresh.
 */
export async function bindWhatsAppAuthDir(params: {
  accountId: string;
  hostRuntime: HostRuntime;
}): Promise<string> {
  const authDir = whatsAppAuthDirFor(params.accountId);
  await closingByDir.get(authDir)?.catch(() => undefined);
  if (boundByDir.has(authDir)) return authDir;
  const store = openAuthStore(params.hostRuntime);
  const stored = await loadAuthSnapshot(store);
  await sweepStaleAuthParts(store, stored.header);
  boundByDir.set(authDir, {
    accountId: params.accountId,
    authDir,
    store,
    files: new Map<string, AuthFile>(Object.entries(stored.files)),
    ...(stored.header ? { header: stored.header } : {}),
    chain: Promise.resolve(),
  });
  return authDir;
}

/**
 * Forgets the account's in-memory copy, then flushes what it still owed. The
 * copy leaves the directory map first, so no write lands on it after the flush
 * — a late persist through a forgotten copy could race a rebind's sweep and
 * leave a header naming deleted parts.
 */
export async function unbindWhatsAppAuthDir(accountId: string): Promise<void> {
  const authDir = whatsAppAuthDirFor(accountId);
  const bound = boundByDir.get(authDir);
  if (!bound) return;
  boundByDir.delete(authDir);
  const closing = flushBound(bound);
  closingByDir.set(authDir, closing);
  try {
    await closing;
  } finally {
    if (closingByDir.get(authDir) === closing) closingByDir.delete(authDir);
  }
}

/** Awaits every pending auth write for one account (or all of them). */
export async function flushWhatsAppAuth(accountId?: string): Promise<void> {
  const targets =
    accountId === undefined
      ? [...boundByDir.values()]
      : [boundByDir.get(whatsAppAuthDirFor(accountId))].filter(
          (bound): bound is BoundAuthDir => bound !== undefined,
        );
  await Promise.all(targets.map(flushBound));
}

/** Waits until no persist is scheduled or running, including ones scheduled while waiting. */
async function flushBound(bound: BoundAuthDir): Promise<void> {
  let pending = bound.scheduled ?? bound.chain;
  for (;;) {
    await pending;
    const next = bound.scheduled ?? bound.chain;
    if (next === pending) return;
    pending = next;
  }
}

function snapshot(bound: BoundAuthDir): StoredAuthDir {
  return { files: Object.fromEntries(bound.files) };
}

/** Schedules (or joins) the next persist; resolves once it is durable. */
function persist(bound: BoundAuthDir): Promise<void> {
  if (bound.scheduled) return bound.scheduled;
  const scheduled = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (bound.scheduled === scheduled) bound.scheduled = undefined;
      const value = snapshot(bound);
      bound.chain = bound.chain
        .catch(() => undefined)
        .then(async () => {
          bound.header = await saveAuthSnapshot(bound.store, bound.header, value);
        });
      bound.chain.then(resolve, reject);
    }, WHATSAPP_AUTH_FLUSH_DELAY_MS);
  });
  bound.scheduled = scheduled;
  return scheduled;
}

// ── Path model ──────────────────────────────────────────────────────────────

function fsError(code: "ENOENT" | "EACCES" | "EISDIR", filePath: string): NodeJS.ErrnoException {
  const message =
    code === "ENOENT"
      ? `ENOENT: no such file or directory, '${filePath}'`
      : code === "EISDIR"
        ? `EISDIR: illegal operation on a directory, '${filePath}'`
        : `EACCES: WhatsApp auth state lives in the encrypted channel store, not on disk: '${filePath}'`;
  return Object.assign(new Error(message), { code, path: filePath });
}

/** The bound directory a file lives in, when the path names a file in one. */
function locateFile(filePath: string): { bound: BoundAuthDir; name: string } | undefined {
  const resolved = path.resolve(filePath);
  const bound = boundByDir.get(path.dirname(resolved));
  return bound ? { bound, name: path.basename(resolved) } : undefined;
}

/** A virtual directory: the root, its ancestors' children down to each bound dir. */
function isVirtualDirectory(dirPath: string): boolean {
  const resolved = path.resolve(dirPath);
  if (resolved === WHATSAPP_AUTH_ROOT || resolved === path.dirname(WHATSAPP_AUTH_ROOT)) {
    return true;
  }
  if (resolved === path.join(WHATSAPP_AUTH_ROOT, "whatsapp")) return true;
  for (const authDir of boundByDir.keys()) {
    if (authDir === resolved || authDir.startsWith(`${resolved}${path.sep}`)) return true;
  }
  return false;
}

export type AuthFsStats = {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

function fileStats(file: AuthFile): AuthFsStats {
  return {
    size: Buffer.byteLength(file.content, "utf8"),
    mtimeMs: file.mtimeMs,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
}

const DIRECTORY_STATS: AuthFsStats = {
  size: 0,
  mtimeMs: 0,
  isFile: () => false,
  isDirectory: () => true,
  isSymbolicLink: () => false,
};

function statSync(filePath: string): AuthFsStats {
  const located = locateFile(filePath);
  const file = located?.bound.files.get(located.name);
  if (file) return fileStats(file);
  if (isVirtualDirectory(filePath)) return DIRECTORY_STATS;
  throw fsError("ENOENT", filePath);
}

function readFileText(filePath: string): string {
  const located = locateFile(filePath);
  const file = located?.bound.files.get(located.name);
  if (file) return file.content;
  throw fsError(isVirtualDirectory(filePath) ? "EISDIR" : "ENOENT", filePath);
}

function writeFileText(filePath: string, content: string): Promise<void> {
  const located = locateFile(filePath);
  if (!located) return Promise.reject(fsError("EACCES", filePath));
  located.bound.files.set(located.name, { content, mtimeMs: Date.now() });
  return persist(located.bound);
}

function removePath(target: string): Promise<void> {
  const resolved = path.resolve(target);
  const bound = boundByDir.get(resolved);
  if (bound) {
    bound.files.clear();
    return persist(bound);
  }
  const located = locateFile(resolved);
  if (!located || !located.bound.files.delete(located.name)) return Promise.resolve();
  return persist(located.bound);
}

export type AuthFsDirent = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

function readdirEntries(dirPath: string): AuthFsDirent[] {
  const resolved = path.resolve(dirPath);
  if (!isVirtualDirectory(resolved)) throw fsError("ENOENT", dirPath);
  const bound = boundByDir.get(resolved);
  if (bound) {
    return [...bound.files.keys()].map((name) => ({
      name,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    }));
  }
  const children = new Set<string>();
  for (const authDir of boundByDir.keys()) {
    if (!authDir.startsWith(`${resolved}${path.sep}`)) continue;
    const child = authDir.slice(resolved.length + 1).split(path.sep)[0];
    if (child) children.add(child);
  }
  return [...children].map((name) => ({
    name,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }));
}

// ── `node:fs` / `node:fs/promises` shapes the ported files call ─────────────

export function readdirSync(dirPath: string, _options?: { withFileTypes: true }): AuthFsDirent[] {
  return readdirEntries(dirPath);
}

export function readFileSync(filePath: string, _encoding?: BufferEncoding): string {
  return readFileText(filePath);
}

export async function lstat(filePath: string): Promise<AuthFsStats> {
  return statSync(filePath);
}

export async function readdir(
  dirPath: string,
  _options?: { withFileTypes: true },
): Promise<AuthFsDirent[]> {
  return readdirEntries(dirPath);
}

export async function rm(
  target: string,
  _options?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  await removePath(target);
}

/** There are no links in the virtual tree; a path that exists is its own real path. */
export async function realpath(target: string): Promise<string> {
  statSync(target);
  return path.resolve(target);
}

export async function readFile(filePath: string, _encoding?: BufferEncoding): Promise<string> {
  return readFileText(filePath);
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await writeFileText(filePath, content);
}

/** Upstream `ensureDir`: a bound auth directory already exists; anything else is refused. */
export async function ensureDir(dirPath: string): Promise<void> {
  if (!isVirtualDirectory(dirPath)) throw fsError("EACCES", dirPath);
}

// ── `plugin-sdk/file-access-runtime` / `security-runtime` subset ────────────

/** The virtual tree has no symlinks, so there is no parent to reject. */
export async function assertNoSymlinkParents(_params: unknown): Promise<void> {}

export function assertNoSymlinkParentsSync(_params: unknown): void {}

export function isPathStrictlyInside(baseDir: string, target: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

type RegularFileRead = { buffer: Buffer; stat: AuthFsStats };

export function readRegularFileSync(params: { filePath: string }): RegularFileRead {
  const content = readFileText(params.filePath);
  return { buffer: Buffer.from(content, "utf8"), stat: statSync(params.filePath) };
}

export async function readRegularFile(params: { filePath: string }): Promise<RegularFileRead> {
  return readRegularFileSync(params);
}

type RegularFileStat = { missing: true; stat?: undefined } | { missing: false; stat: AuthFsStats };

export function statRegularFileSync(filePath: string): RegularFileStat {
  let stats: AuthFsStats;
  try {
    stats = statSync(filePath);
  } catch {
    return { missing: true };
  }
  if (!stats.isFile()) throw fsError("EISDIR", filePath);
  return { missing: false, stat: stats };
}

export async function statRegularFile(filePath: string): Promise<RegularFileStat> {
  return statRegularFileSync(filePath);
}

/** Upstream `replaceFileAtomic`: the store write is atomic by construction. */
export async function replaceFileAtomic(params: {
  filePath: string;
  content: string;
  beforeRename?: (params: { filePath: string }) => Promise<void>;
  [option: string]: unknown;
}): Promise<void> {
  await params.beforeRename?.({ filePath: params.filePath });
  await writeFileText(params.filePath, params.content);
}

// Per-account keyed store — the host-runtime backing for OpenClaw's
// `state.openKeyedStore` / `state.openSyncKeyedStore` (plan §7, implementation
// doc §4.2). The pinned Slack and Telegram verticals persist per-key runtime
// state through this seam: Telegram's long-poll update offset
// (`telegram.update-offsets`), its sent-message dedupe cache
// (`telegram.sent-messages`), and Slack's send-dedupe store.
//
// OpenClaw natively backs this seam with a SQLite `plugin_state_entries`
// table. P0 binds the seam to the Hub host runtime instead, so this module is
// a JSON-file approximation of that store: one file per namespace under the
// account's channel dir (`channels/<organizationId>/<channel>/<accountId>/state/<namespace>.json`),
// atomic write (tmp + rename), loaded into memory at open, write-through on
// every mutation. One Hub process per home, so there is no cross-process
// locking to replicate.
//
// The surface mirrors the pinned native store (openclaw@2026.7.1-2
// `plugin-state-store` .d.ts and dist) so the pinned verticals run unmodified:
// upsert on `register`, insert-if-absent on `registerIfAbsent`, TTL via
// `ttlMs` / `defaultTtlMs` (expiry = now + ttlMs; enforced on every read and
// swept on every write), `maxEntries` eviction (`evict-oldest` by
// createdAt, then key; `reject-new` throws), and `PluginStateEntry`-shaped
// `entries()`. Deliberately NOT approximated: the 50k per-plugin row cap, the
// `env` option (accepted, ignored), and `core:` plugin-id reservation (one
// root is already one account).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type KeyedStoreOverflowPolicy = "evict-oldest" | "reject-new";

/** One entry as `entries()` reports it — the native `PluginStateEntry` shape. */
export interface HostKeyedStoreEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt?: number;
}

/** Options for opening a keyed-store namespace — the native
 * `OpenKeyedStoreOptions`. `env` is accepted for native fidelity and ignored. */
export interface HostKeyedStoreOptions {
  namespace: string;
  maxEntries: number;
  overflowPolicy?: KeyedStoreOverflowPolicy;
  defaultTtlMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Per-write TTL override. */
export interface KeyedStoreTtlOptions {
  ttlMs?: number;
}

/** Async keyed store — the native `PluginStateKeyedStore` surface. */
export interface HostKeyedStore<T = unknown> {
  register(key: string, value: T, opts?: KeyedStoreTtlOptions): Promise<void>;
  registerIfAbsent(key: string, value: T, opts?: KeyedStoreTtlOptions): Promise<boolean>;
  update(
    key: string,
    updateValue: (current: T | undefined) => T | undefined,
    opts?: KeyedStoreTtlOptions,
  ): Promise<boolean>;
  lookup(key: string): Promise<T | undefined>;
  consume(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<HostKeyedStoreEntry<T>[]>;
  clear(): Promise<void>;
}

/** Sync keyed store — the native `PluginStateSyncKeyedStore` surface. */
export interface HostSyncKeyedStore<T = unknown> {
  register(key: string, value: T, opts?: KeyedStoreTtlOptions): void;
  registerIfAbsent(key: string, value: T, opts?: KeyedStoreTtlOptions): boolean;
  update(
    key: string,
    updateValue: (current: T | undefined) => T | undefined,
    opts?: KeyedStoreTtlOptions,
  ): boolean;
  lookup(key: string): T | undefined;
  consume(key: string): T | undefined;
  delete(key: string): boolean;
  entries(): HostKeyedStoreEntry<T>[];
  clear(): void;
  /**
   * Await the backing's durability for everything written so far.
   *
   * The sync surface cannot await its own writes, and the encrypted backing is
   * write-behind, so a caller that must not report success before the bytes are
   * durable — the QR link path, answering "linked" with a freshly scanned
   * session — awaits this. Plain-file namespaces resolve immediately.
   */
  flush(): Promise<void>;
}

/** A keyed-store root: one per account, owning the backing + the open
 * namespaces. `createHostKeyedStoreRoot` builds it for the host runtime's
 * `state` block. */
export interface HostKeyedStoreRoot {
  openKeyedStore(options: HostKeyedStoreOptions): HostKeyedStore;
  openSyncKeyedStore(options: HostKeyedStoreOptions): HostSyncKeyedStore;
  /** Await every backing this root writes through (see `HostSyncKeyedStore.flush`). */
  flush(): Promise<void>;
}

/** Thrown for store faults. `code` mirrors the native
 * `PluginStateStoreError` codes so a vertical that inspects codes sees the
 * same value. */
export class ChannelStateStoreError extends Error {
  readonly code: string;
  readonly operation: string;

  constructor(message: string, code: string, operation: string) {
    super(message);
    this.name = "ChannelStateStoreError";
    this.code = code;
    this.operation = operation;
  }
}

// --- Validation (native-faithful) -------------------------------------------

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const MAX_NAMESPACE_BYTES = 128;
const MAX_KEY_BYTES = 512;
const MAX_VALUE_BYTES = 65_536;
const MAX_JSON_DEPTH = 64;
const textEncoder = new TextEncoder();

function invalidInput(message: string, operation: string): ChannelStateStoreError {
  return new ChannelStateStoreError(message, "PLUGIN_STATE_INVALID_INPUT", operation);
}

function limitExceeded(message: string, operation: string): ChannelStateStoreError {
  return new ChannelStateStoreError(message, "PLUGIN_STATE_LIMIT_EXCEEDED", operation);
}

function validateNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  if (!NAMESPACE_PATTERN.test(trimmed)) {
    throw invalidInput(`plugin state namespace must be a safe path segment: ${namespace}`, "open");
  }
  if (textEncoder.encode(trimmed).byteLength > MAX_NAMESPACE_BYTES) {
    throw invalidInput(`plugin state namespace must be <= ${MAX_NAMESPACE_BYTES} bytes`, "open");
  }
  return trimmed;
}

function validateKey(key: string, operation: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw invalidInput("plugin state entry key must not be empty", operation);
  if (textEncoder.encode(trimmed).byteLength > MAX_KEY_BYTES) {
    throw invalidInput(`plugin state entry key must be <= ${MAX_KEY_BYTES} bytes`, operation);
  }
  return trimmed;
}

function validateMaxEntries(maxEntries: number): number {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw invalidInput("plugin state maxEntries must be an integer >= 1", "open");
  }
  return maxEntries;
}

function validateOverflowPolicy(
  policy: KeyedStoreOverflowPolicy | undefined,
): KeyedStoreOverflowPolicy {
  if (policy === undefined || policy === "evict-oldest") return "evict-oldest";
  if (policy === "reject-new") return policy;
  throw invalidInput("plugin state overflowPolicy must be evict-oldest or reject-new", "open");
}

function validateTtlMs(ttlMs: number | undefined, operation: string): number | undefined {
  if (ttlMs === undefined || ttlMs === null) return undefined;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw invalidInput("plugin state ttlMs must be a positive integer", operation);
  }
  return ttlMs;
}

/** Assert `value` is a plain JSON value (finite numbers, data properties, no
 * cycles, depth <= 64) — the native `assertPlainJsonValue`. */
export function assertPlainJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
  depth = 0,
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw limitExceeded("plugin state value nesting exceeds maximum depth of 64", "register");
  }
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    if (!Number.isFinite(value))
      throw invalidInput(`plugin state value at ${path} must be a finite number`, "register");
    return;
  }
  if (type !== "object")
    throw invalidInput(`plugin state value at ${path} must be JSON-serializable`, "register");
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw invalidInput(
      `plugin state value at ${path} must not contain circular references`,
      "register",
    );
  }
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      for (let index = 0; index < objectValue.length; index += 1) {
        if (!(index in objectValue))
          throw invalidInput(`plugin state array at ${path} must not be sparse`, "register");
        assertPlainJsonValue(objectValue[index], seen, `${path}[${index}]`, depth + 1);
      }
      return;
    }
    if (Object.getPrototypeOf(objectValue) !== Object.prototype) {
      throw invalidInput(`plugin state object at ${path} must be a plain object`, "register");
    }
    if (Object.getOwnPropertySymbols(objectValue).length > 0) {
      throw invalidInput(`plugin state object at ${path} must not use symbol keys`, "register");
    }
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(objectValue));
    if (descriptors.length !== Object.keys(objectValue).length) {
      throw invalidInput(
        `plugin state object at ${path} must have enumerable own properties`,
        "register",
      );
    }
    for (const [property, descriptor] of descriptors) {
      if (descriptor.get || descriptor.set || !("value" in descriptor)) {
        throw invalidInput(
          `plugin state object at ${path}.${property} must use data properties`,
          "register",
        );
      }
      assertPlainJsonValue(descriptor.value, seen, `${path}.${property}`, depth + 1);
    }
  } finally {
    seen.delete(objectValue);
  }
}

function prepareValue(key: string, value: unknown, operation: string): string {
  assertPlainJsonValue(value, new WeakSet(), "value");
  const json = JSON.stringify(value);
  if (textEncoder.encode(json).byteLength > MAX_VALUE_BYTES) {
    throw limitExceeded("plugin state value exceeds 64KB limit", operation);
  }
  return json;
}

// --- Backing ------------------------------------------------------------------

/** One persisted entry. `expiresAt` is null when the entry has no TTL. */
export interface StoredEntry {
  key: string;
  value: unknown;
  createdAt: number;
  expiresAt: number | null;
}

/**
 * Read/write backing for a store root. `load`/`save` are SYNCHRONOUS because
 * the native store is: the ported verticals write credentials from a sync
 * closure. A backend whose real durability is asynchronous (the encrypted
 * database backing) therefore loads from a snapshot taken before the root is
 * built, and writes behind — `flush` is how the async facade waits for those
 * writes and reports their failure.
 */
export interface KeyedStoreBackend {
  load(namespace: string): StoredEntry[];
  save(namespace: string, entries: StoredEntry[]): void;
  /** Resolves once every `save` issued so far is durable; rejects on the first
   * failure. Absent on backends whose `save` is already durable. */
  flush?(): Promise<void>;
}

function namespaceFile(dir: string, namespace: string): string {
  return join(dir, `${namespace}.json`);
}

/** The entry order every listing / eviction reports: createdAt, then key. */
function byCreatedThenKey(a: StoredEntry, b: StoredEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

function parsePersistedEntries(raw: string, operation: string): StoredEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChannelStateStoreError(
      "channel state entry contains corrupt JSON",
      "PLUGIN_STATE_CORRUPT",
      operation,
    );
  }
  const doc = parsed as { version?: unknown; entries?: unknown };
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    doc.version !== 1 ||
    !Array.isArray(doc.entries)
  ) {
    throw new ChannelStateStoreError(
      "channel state file has an unrecognized shape",
      "PLUGIN_STATE_CORRUPT",
      operation,
    );
  }
  return doc.entries.map((item, index) => {
    const entry = item as {
      key?: unknown;
      value?: unknown;
      createdAt?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof entry?.key !== "string" ||
      typeof entry.createdAt !== "number" ||
      (entry.expiresAt !== undefined &&
        entry.expiresAt !== null &&
        typeof entry.expiresAt !== "number")
    ) {
      throw new ChannelStateStoreError(
        `channel state entry ${index} has an unrecognized shape`,
        "PLUGIN_STATE_CORRUPT",
        operation,
      );
    }
    return {
      key: entry.key,
      value: entry.value,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt ?? null,
    };
  });
}

/** JSON-file backing under the account's state dir. */
function createFileBackend(dir: string): KeyedStoreBackend {
  return {
    load(namespace) {
      const file = namespaceFile(dir, namespace);
      if (!existsSync(file)) return [];
      return parsePersistedEntries(readFileSync(file, "utf8"), "open");
    },
    save(namespace, entries) {
      mkdirSync(dir, { recursive: true });
      const file = namespaceFile(dir, namespace);
      const tmp = `${file}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ version: 1, entries }), "utf8");
      renameSync(tmp, file);
    },
  };
}

/** In-memory backing (host runtimes built without a state dir — fixtures). */
function createMemoryBackend(): KeyedStoreBackend {
  const files = new Map<string, string>();
  return {
    load(namespace) {
      const raw = files.get(namespace);
      return raw === undefined ? [] : parsePersistedEntries(raw, "open");
    },
    save(namespace, entries) {
      files.set(namespace, JSON.stringify({ version: 1, entries }));
    },
  };
}

// --- The namespace store ------------------------------------------------------

/** One open namespace: in-memory entries + write-through persistence. */
class NamespaceStore {
  private readonly backend: KeyedStoreBackend;
  private readonly entries = new Map<string, StoredEntry>();
  private readonly now: () => number;
  readonly namespace: string;
  readonly maxEntries: number;
  readonly overflowPolicy: KeyedStoreOverflowPolicy;
  readonly defaultTtlMs: number | undefined;

  constructor(
    backend: KeyedStoreBackend,
    namespace: string,
    maxEntries: number,
    overflowPolicy: KeyedStoreOverflowPolicy,
    defaultTtlMs: number | undefined,
    now: () => number,
  ) {
    this.backend = backend;
    this.namespace = namespace;
    this.maxEntries = maxEntries;
    this.overflowPolicy = overflowPolicy;
    this.defaultTtlMs = defaultTtlMs;
    this.now = now;
    for (const entry of backend.load(namespace)) this.entries.set(entry.key, entry);
  }

  private persist(): void {
    this.backend.save(this.namespace, [...this.entries.values()]);
  }

  private isLive(entry: StoredEntry, nowMs: number): boolean {
    return entry.expiresAt === null || entry.expiresAt > nowMs;
  }

  private liveEntries(nowMs: number): StoredEntry[] {
    return [...this.entries.values()].filter((entry) => this.isLive(entry, nowMs));
  }

  private sweepExpired(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (!this.isLive(entry, nowMs)) this.entries.delete(key);
    }
  }

  /** `reject-new`: refuse a NEW key once the live count hits the cap. An
   * upsert of a live key never counts against the cap (native parity). */
  private assertCanInsert(nowMs: number): void {
    if (this.overflowPolicy !== "reject-new") return;
    if (this.liveEntries(nowMs).length >= this.maxEntries) {
      throw limitExceeded(
        `plugin state namespace ${this.namespace} reached its ${this.maxEntries}-row limit`,
        "register",
      );
    }
  }

  /** `evict-oldest`: after a write, evict the oldest live entries (createdAt,
   * then key) until the cap holds; the just-written key is protected. */
  private evictOverflow(nowMs: number, protectedKey: string): void {
    if (this.overflowPolicy !== "evict-oldest") return;
    let live = this.liveEntries(nowMs);
    if (live.length <= this.maxEntries) return;
    const evictable = live.filter((entry) => entry.key !== protectedKey).sort(byCreatedThenKey);
    const excess = live.length - this.maxEntries;
    for (const entry of evictable.slice(0, excess)) this.entries.delete(entry.key);
  }

  private write(key: string, value: unknown, ttlMs: number | undefined, nowMs: number): void {
    this.entries.set(key, {
      key,
      value,
      createdAt: nowMs,
      expiresAt: ttlMs === undefined ? null : nowMs + ttlMs,
    });
    this.evictOverflow(nowMs, key);
    this.persist();
  }

  register(key: string, value: unknown, ttlMs?: number): void {
    const normalized = validateKey(key, "register");
    prepareValue(normalized, value, "register");
    const nowMs = this.now();
    this.sweepExpired(nowMs);
    if (!this.entries.has(normalized)) this.assertCanInsert(nowMs);
    this.write(normalized, value, validateTtlMs(ttlMs, "register") ?? this.defaultTtlMs, nowMs);
  }

  registerIfAbsent(key: string, value: unknown, ttlMs?: number): boolean {
    const normalized = validateKey(key, "register");
    prepareValue(normalized, value, "register");
    const nowMs = this.now();
    this.sweepExpired(nowMs);
    if (this.entries.has(normalized)) return false;
    this.assertCanInsert(nowMs);
    this.write(normalized, value, validateTtlMs(ttlMs, "register") ?? this.defaultTtlMs, nowMs);
    return true;
  }

  update(key: string, updateValue: (current: unknown) => unknown, ttlMs?: number): boolean {
    const normalized = validateKey(key, "update");
    const nowMs = this.now();
    this.sweepExpired(nowMs);
    const existing = this.entries.get(normalized);
    const next = updateValue(existing ? existing.value : undefined);
    if (next === undefined) return false;
    prepareValue(normalized, next, "update");
    if (existing === undefined) this.assertCanInsert(nowMs);
    this.write(normalized, next, validateTtlMs(ttlMs, "update") ?? this.defaultTtlMs, nowMs);
    return true;
  }

  lookup(key: string): unknown | undefined {
    const normalized = validateKey(key, "lookup");
    const entry = this.entries.get(normalized);
    if (entry === undefined || !this.isLive(entry, this.now())) return undefined;
    return entry.value;
  }

  consume(key: string): unknown | undefined {
    const normalized = validateKey(key, "consume");
    const entry = this.entries.get(normalized);
    if (entry === undefined || !this.isLive(entry, this.now())) return undefined;
    this.entries.delete(normalized);
    this.persist();
    return entry.value;
  }

  delete(key: string): boolean {
    const normalized = validateKey(key, "delete");
    const removed = this.entries.delete(normalized);
    if (removed) this.persist();
    return removed;
  }

  listEntries(): HostKeyedStoreEntry<unknown>[] {
    const nowMs = this.now();
    const live = this.liveEntries(nowMs).sort(byCreatedThenKey);
    const entries: HostKeyedStoreEntry<unknown>[] = [];
    for (const entry of live) {
      const reported: HostKeyedStoreEntry<unknown> = {
        key: entry.key,
        value: entry.value,
        createdAt: entry.createdAt,
      };
      // `expiresAt` is absent (not null) on entries without a TTL — the native
      // `PluginStateEntry` shape.
      if (entry.expiresAt !== null) reported.expiresAt = entry.expiresAt;
      entries.push(reported);
    }
    return entries;
  }

  clear(): void {
    this.entries.clear();
    this.persist();
  }
}

// --- Facades + root ------------------------------------------------------------

function syncFacade(store: NamespaceStore, backend: KeyedStoreBackend): HostSyncKeyedStore {
  return {
    flush: async () => {
      await backend.flush?.();
    },
    register: (key, value, opts) => store.register(key, value, opts?.ttlMs),
    registerIfAbsent: (key, value, opts) => store.registerIfAbsent(key, value, opts?.ttlMs),
    update: (key, updateValue, opts) => store.update(key, updateValue, opts?.ttlMs),
    lookup: (key) => store.lookup(key),
    consume: (key) => store.consume(key),
    delete: (key) => store.delete(key),
    entries: () => store.listEntries(),
    clear: () => store.clear(),
  };
}

/** The async surface. Every mutation awaits the backend's durability so a
 * caller that awaited `register` has a persisted entry — which is what lets the
 * encrypted backing be write-behind without lying to the vertical. */
function asyncFacade(store: NamespaceStore, backend: KeyedStoreBackend): HostKeyedStore {
  const durable = async <T>(result: T): Promise<T> => {
    await backend.flush?.();
    return result;
  };
  return {
    register: async (key, value, opts) => durable(store.register(key, value, opts?.ttlMs)),
    registerIfAbsent: async (key, value, opts) =>
      durable(store.registerIfAbsent(key, value, opts?.ttlMs)),
    update: async (key, updateValue, opts) => durable(store.update(key, updateValue, opts?.ttlMs)),
    lookup: async (key) => store.lookup(key),
    consume: async (key) => durable(store.consume(key)),
    delete: async (key) => durable(store.delete(key)),
    entries: async () => store.listEntries(),
    clear: async () => durable(store.clear()),
  };
}

interface OpenedNamespace {
  store: NamespaceStore;
  signature: {
    maxEntries: number;
    overflowPolicy: KeyedStoreOverflowPolicy;
    defaultTtlMs: number | undefined;
  };
}

/**
 * Build the host-runtime keyed-store root. `dir` is the account's state dir
 * (`channels/<organizationId>/<channel>/<accountId>/state/`); omit it for an in-memory root (load-time
 * fixtures, nothing persists). Reopening a namespace with different
 * `maxEntries` / `overflowPolicy` / `defaultTtlMs` fails (native parity).
 *
 * `secret` routes the NAMED namespaces to a second backend instead of the
 * plain JSON file — the mechanism behind "encrypted keyed-store namespaces"
 * (`state/encrypted-namespaces.ts` names them, `state/secret-backend.ts`
 * supplies the backing). Nothing else about the store changes: the vertical
 * opens the same namespace and cannot tell which backing it got.
 */
export function createHostKeyedStoreRoot(
  options: {
    dir?: string;
    now?: () => number;
    secret?: { namespaces: readonly string[]; backend: KeyedStoreBackend };
  } = {},
): HostKeyedStoreRoot {
  const plain = options.dir === undefined ? createMemoryBackend() : createFileBackend(options.dir);
  const secretNamespaces = new Set(options.secret?.namespaces ?? []);
  const backendFor = (namespace: string): KeyedStoreBackend =>
    options.secret !== undefined && secretNamespaces.has(namespace)
      ? options.secret.backend
      : plain;
  const now = options.now ?? (() => Date.now());
  const opened = new Map<string, OpenedNamespace>();

  function openNamespace(rawOptions: HostKeyedStoreOptions): {
    store: NamespaceStore;
    backend: KeyedStoreBackend;
  } {
    const namespace = validateNamespace(rawOptions.namespace);
    const signature = {
      maxEntries: validateMaxEntries(rawOptions.maxEntries),
      overflowPolicy: validateOverflowPolicy(rawOptions.overflowPolicy),
      defaultTtlMs: validateTtlMs(rawOptions.defaultTtlMs, "open"),
    };
    const existing = opened.get(namespace);
    if (existing !== undefined) {
      if (
        existing.signature.maxEntries !== signature.maxEntries ||
        existing.signature.overflowPolicy !== signature.overflowPolicy ||
        existing.signature.defaultTtlMs !== signature.defaultTtlMs
      ) {
        throw invalidInput(
          `plugin state namespace ${namespace} was reopened with incompatible options`,
          "open",
        );
      }
      return { store: existing.store, backend: backendFor(namespace) };
    }
    const backend = backendFor(namespace);
    const store = new NamespaceStore(
      backend,
      namespace,
      signature.maxEntries,
      signature.overflowPolicy,
      signature.defaultTtlMs,
      now,
    );
    opened.set(namespace, { store, signature });
    return { store, backend };
  }

  return {
    openKeyedStore: (rawOptions) => {
      const namespace = openNamespace(rawOptions);
      return asyncFacade(namespace.store, namespace.backend);
    },
    openSyncKeyedStore: (rawOptions) => {
      const namespace = openNamespace(rawOptions);
      return syncFacade(namespace.store, namespace.backend);
    },
    flush: async () => {
      await plain.flush?.();
      await options.secret?.backend.flush?.();
    },
  };
}

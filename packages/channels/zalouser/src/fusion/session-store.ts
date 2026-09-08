// Fusion-owned session/credential persistence boundary (D-ZU-004).
//
// Zalo Personal has no bot token. A session is a QR login: `zca-js` returns an
// `imei`, a cookie jar and a user agent, and every later API call replays them.
// Those bytes ARE the account — losing them means another human QR scan, and
// leaking them means full impersonation of a personal Zalo account.
//
// Upstream keeps them in OpenClaw's SQLite-backed plugin state
// (`plugin-sdk/plugin-state-runtime` `openSyncKeyedStore`, namespace
// `credentials`), reached through the global plugin runtime store. Fusion has
// neither, and the runtime-strategy rule for this family (§0.1 note 7) is that
// QR-login session files keep NATIVE STORAGE SEMANTICS with encrypted-at-rest
// storage — not that every auth byte is forced into the Hub DB. So this module
// is the seam:
//
//   * `ZalouserSessionStore` — the async persistence port. One implementation
//     ships here (`createHostRuntimeSessionStore`, over the injected
//     `HostRuntime.state.openKeyedStore`); the Hub owns encryption at rest
//     behind that store (see HUB-WIRING.md §6).
//   * `ZalouserSessionCache` — the SYNCHRONOUS `lookup`/`register`/`update`
//     surface upstream's `session-state.ts` is written against. Keeping it sync
//     is what lets the 1900-line `zalo-js.ts` credential closure stay
//     byte-identical to upstream: reads are served from a cache hydrated at
//     account start, writes go to the cache immediately and to the store
//     write-behind.
//
// Write-behind is not fire-and-forget: `flushZalouserSessions()` awaits the
// pending writes and rethrows the first failure, and the QR-login and logout
// paths flush before they report success (`fusion/qr-setup.ts`). A background
// credential refresh that cannot be persisted stays best-effort, which is
// upstream's own rule ("do not fail an already-successful Zalo operation only
// because the best-effort session refresh could not be persisted").
//
// The registry is keyed by ACCOUNT, and this is a security boundary, not a
// convenience. The Hub runs every vertical in one process, `plugin.setup`'s
// `bindAccountSession` binds an account whenever an operator opens the QR
// screen, and a Hub keyed store is encrypted per organization+account. A single
// global store therefore meant that binding account B pointed account A's live
// credential refreshes at B's encrypted namespace — A's Zalo session cookies,
// which ARE the account, written into another tenant's store — and cleared A's
// cache out from under its running listener. Each account now owns its own
// store and its own cache slice; the sync facade the verbatim
// `session-state.ts` reads resolves a key to the account that already holds it,
// and only a key no account holds goes to the most recently bound one (which is
// the account whose QR login is minting it).

import type { HostRuntime } from "@getpaseo/channels-shared";
import type { ZaloCredentialStateRecord } from "../session-state.js";

/** The async persistence port. Keys are `session-state.ts`'s hashed
 * `profile:<sha256>` store keys; values are the credential or revocation
 * record. Implementations are expected to encrypt at rest. */
export interface ZalouserSessionStore {
  /** Every stored record, for the sync cache's hydration. */
  entries(): Promise<Array<{ key: string; value: ZaloCredentialStateRecord }>>;
  /** Persists (or replaces) one record. */
  register(key: string, value: ZaloCredentialStateRecord): Promise<void>;
}

/** The synchronous surface the ported `session-state.ts` is written against —
 * upstream's `PluginStateSyncKeyedStore` members it actually calls. */
export interface ZalouserSessionCache {
  lookup(key: string): ZaloCredentialStateRecord | undefined;
  register(key: string, value: ZaloCredentialStateRecord): void;
  update(
    key: string,
    updateValue: (
      current: ZaloCredentialStateRecord | undefined,
    ) => ZaloCredentialStateRecord | undefined,
  ): void;
}

/** Upstream `session-state.ts`: the plugin-state namespace and its cap. */
export const ZALOUSER_SESSION_NAMESPACE = "credentials";
export const ZALOUSER_SESSION_MAX_ENTRIES = 256;

/** One bound account: its store, its own cache slice, its own write queue. */
interface AccountSessions {
  store: ZalouserSessionStore;
  cache: Map<string, ZaloCredentialStateRecord>;
  pending: Promise<void>;
  pendingError: unknown;
}

const accounts = new Map<string, AccountSessions>();
/** The account a key with no owner is attributed to (the one mid-QR-login). */
let lastBoundAccountId: string | undefined;
/**
 * The account a QR login is minting credentials FOR, while one is running.
 *
 * Store keys are `profile:<sha256(profile)>`, and a profile is not unique to an
 * account: `ZALOUSER_PROFILE` / `ZCA_PROFILE` or an authored `profile` field
 * makes two accounts share one key. Attributing a write by "whichever cache
 * already holds the key" then sends the freshly scanned session — which IS the
 * account — into the other account's encrypted namespace, and a relink is
 * exactly the case where another cache does hold the key. While a linking verb
 * runs, the account being linked owns every write.
 */
let mintingAccountId: string | undefined;

/** Binds `accountId` to its persistence port, or unbinds it with `undefined`.
 * Unbinding drops ONLY that account's cached credentials, so a stopping account
 * never takes another account's live session down with it. */
export function installZalouserSessionStore(
  accountId: string,
  next: ZalouserSessionStore | undefined,
): void {
  if (next === undefined) {
    accounts.delete(accountId);
    if (lastBoundAccountId === accountId) lastBoundAccountId = undefined;
    return;
  }
  accounts.set(accountId, {
    store: next,
    cache: new Map(),
    pending: Promise.resolve(),
    pendingError: undefined,
  });
  lastBoundAccountId = accountId;
}

/** Loads `accountId`'s stored records into its cache slice. Called once per
 * account start (`lifecycle/start-account.ts`) and by the QR-setup entry
 * points. Unknown account = nothing to hydrate. */
export async function hydrateZalouserSessions(accountId?: string): Promise<void> {
  const id = accountId ?? lastBoundAccountId;
  if (id === undefined) return;
  const entry = accounts.get(id);
  if (entry === undefined) return;
  const rows = await entry.store.entries();
  entry.cache.clear();
  for (const row of rows) entry.cache.set(row.key, row.value);
}

/** Awaits every bound account's write-behind writes and rethrows the first
 * failure. */
export async function flushZalouserSessions(): Promise<void> {
  for (const entry of accounts.values()) {
    await entry.pending;
    if (entry.pendingError !== undefined) {
      const error = entry.pendingError;
      entry.pendingError = undefined;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

/** The account that owns `key`: the one whose cache already holds it, else the
 * most recently bound one (a key nothing holds is being minted by the QR login
 * that just bound). `undefined` when no account is bound at all. */
function ownerOf(key: string): AccountSessions | undefined {
  const minting = mintingAccountId === undefined ? undefined : accounts.get(mintingAccountId);
  if (minting !== undefined) return minting;
  for (const entry of accounts.values()) {
    if (entry.cache.has(key)) return entry;
  }
  return lastBoundAccountId === undefined ? undefined : accounts.get(lastBoundAccountId);
}

/**
 * Runs one QR-login verb as the account being linked: every credential write it
 * makes belongs to `accountId`, whatever other account caches the same profile
 * key. `undefined` falls back to the account bound last, which is what the Hub's
 * `bindAccountSession` just set (`supervisor/qr-login.ts`).
 */
export async function withZalouserSessionMint<T>(
  accountId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = mintingAccountId;
  mintingAccountId = accountId ?? lastBoundAccountId;
  try {
    return await run();
  } finally {
    mintingAccountId = previous;
  }
}

/** The account the QR verbs bind to when the caller names none. */
export function boundZalouserAccountId(): string | undefined {
  return lastBoundAccountId;
}

/** The cache the ported `session-state.ts` reads and writes. */
export function getZalouserSessionCache(): ZalouserSessionCache {
  return {
    lookup: (key) => {
      for (const entry of accounts.values()) {
        const value = entry.cache.get(key);
        if (value !== undefined) return value;
      }
      return undefined;
    },
    register: (key, value) => {
      const entry = ownerOf(key);
      if (entry === undefined) return;
      entry.cache.set(key, value);
      enqueue(entry, key, value);
    },
    update: (key, updateValue) => {
      const entry = ownerOf(key);
      if (entry === undefined) return;
      const next = updateValue(entry.cache.get(key));
      if (next === undefined) {
        entry.cache.delete(key);
        return;
      }
      entry.cache.set(key, next);
      enqueue(entry, key, next);
    },
  };
}

function enqueue(entry: AccountSessions, key: string, value: ZaloCredentialStateRecord): void {
  entry.pending = entry.pending.then(
    async () => {
      try {
        await entry.store.register(key, value);
      } catch (error) {
        entry.pendingError ??= error;
      }
    },
    () => undefined,
  );
}

/** The shipped implementation: the account's injected `HostRuntime` keyed
 * store. The Hub backs it with its own per-account state and owns encryption at
 * rest; nothing here writes a file. */
export function createHostRuntimeSessionStore(params: {
  hostRuntime: HostRuntime;
  accountId: string;
  env?: NodeJS.ProcessEnv;
}): ZalouserSessionStore {
  // The namespace is upstream's own `credentials`, unqualified: the Hub opens
  // one keyed-store root per account, and a plugin-state namespace must be a
  // safe path segment (upstream `plugin-state/plugin-store-validation.ts`
  // `/^[a-z0-9][a-z0-9._-]*$/i`), which `credentials:<accountId>` is not.
  // `accountId` stays on the params because the Hub keys the encrypted backing
  // by it (HUB-WIRING.md §6).
  const keyed = params.hostRuntime.state.openKeyedStore({
    namespace: ZALOUSER_SESSION_NAMESPACE,
    maxEntries: ZALOUSER_SESSION_MAX_ENTRIES,
    overflowPolicy: "reject-new",
    ...(params.env === undefined ? {} : { env: params.env }),
  });
  return {
    entries: async () =>
      (await keyed.entries()).map((entry) => ({
        key: entry.key,
        value: entry.value as ZaloCredentialStateRecord,
      })),
    register: async (key, value) => {
      await keyed.register(key, value);
    },
  };
}

/** An in-memory store for tests and for a vertical driven without a Hub. */
export function createMemorySessionStore(
  seed: Array<{ key: string; value: ZaloCredentialStateRecord }> = [],
): ZalouserSessionStore & { readonly rows: Map<string, ZaloCredentialStateRecord> } {
  const rows = new Map(seed.map((entry) => [entry.key, entry.value] as const));
  return {
    rows,
    entries: async () => Array.from(rows, ([key, value]) => ({ key, value })),
    register: async (key, value) => {
      rows.set(key, value);
    },
  };
}

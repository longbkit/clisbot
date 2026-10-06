// COMPAT(clisbot-channels): the encrypted backing for the keyed-store
// namespaces `state/encrypted-namespaces.ts` names.
//
// One `channel_state_secrets` row per (organization, channel, account,
// namespace) holds the namespace's whole entry list inside a credential
// envelope, sealed with the cipher and key custody the Connection envelopes
// already use, and bound by AAD to that same scope — so a row lifted into
// another organization fails authentication instead of decrypting.
//
// The seam it plugs into is synchronous (the ported credential closure writes
// from a sync call), so this backend is snapshot-in / write-behind: `open`
// awaits the decrypted rows once, `save` mutates the snapshot and queues a
// serialized upsert, and `flush` awaits the queue and rethrows the first
// failure. The async keyed-store facade flushes after every mutation, so a
// caller that awaited `register` has a durable row.
//
// Nothing here logs a value. Failures are re-raised with the SCOPE only: the
// namespace and account are safe to name, the entries never are.

import type { KeyedStoreBackend, StoredEntry } from "./keyed-store.js";
import type { ChannelStateSecretScope, Database } from "../../db/types.js";

/** The database surface this backend needs — the load + save halves of the
 * state-secret contract. Deletion is the account lifecycle's, not the store's. */
export type ChannelSecretStateDatabase = Pick<
  Database,
  "loadChannelStateSecrets" | "saveChannelStateSecret"
>;

/** Entries survive a round trip as opaque JSON; re-read defensively so a row
 * written by an older shape cannot crash an account start. */
function readEntries(value: unknown): StoredEntry[] {
  return Array.isArray(value) ? (value as StoredEntry[]) : [];
}

/**
 * Open the encrypted backing for one channel account. Awaits the account's
 * stored namespaces once, then serves them synchronously.
 */
export async function openChannelSecretStateBackend(deps: {
  database: ChannelSecretStateDatabase;
  scope: ChannelStateSecretScope;
}): Promise<KeyedStoreBackend> {
  const snapshot = new Map<string, StoredEntry[]>();
  for (const row of await deps.database.loadChannelStateSecrets(deps.scope)) {
    snapshot.set(row.namespace, readEntries(row.entries));
  }
  let pending: Promise<void> = Promise.resolve();
  let failure: unknown;
  // Namespaces whose upsert is queued but has not started, with the entries it
  // will write. A save while one is waiting only replaces those entries: every
  // upsert re-encrypts the whole namespace, so a burst of mutations (a vertical
  // writing several entries at once) costs one write, not one per mutation. A
  // caller that awaits `flush` after its save still waits for an upsert that
  // carries its entries.
  const queued = new Map<string, StoredEntry[]>();

  const write = (namespace: string) => {
    const entries = queued.get(namespace) ?? [];
    queued.delete(namespace);
    return deps.database
      .saveChannelStateSecret({ ...deps.scope, namespace, entries })
      .catch((error: unknown) => {
        failure ??= new Error(
          `could not persist encrypted channel state for ${deps.scope.channel} account ${deps.scope.accountId} namespace ${namespace}`,
          { cause: error },
        );
      });
  };

  return {
    load: (namespace) => [...(snapshot.get(namespace) ?? [])],
    save: (namespace, entries) => {
      const persisted = [...entries];
      snapshot.set(namespace, persisted);
      const waiting = queued.has(namespace);
      queued.set(namespace, persisted);
      if (waiting) return;
      pending = pending.then(() => write(namespace));
    },
    flush: async () => {
      await pending;
      if (failure === undefined) return;
      const error = failure;
      failure = undefined;
      throw error;
    },
  };
}

import type { DaemonClient } from "@clisbot/client/internal/daemon-client";

type Feed = ReturnType<DaemonClient["observeEvents"]>;
type Observer = Parameters<Feed["subscribe"]>[0];
interface Entry {
  users: number;
  release: () => void;
}

/** One reconciliation observer per actual client/admission, shared by catalog consumers. */
export function createCatalogEventFeeds() {
  const clients = new WeakMap<DaemonClient, Map<string, Entry>>();
  return function retain(
    client: DaemonClient,
    admission: string,
    isCurrent: () => boolean,
    observer: Observer,
  ): () => void {
    let entries = clients.get(client);
    if (!entries) {
      entries = new Map();
      clients.set(client, entries);
    }
    let entry = entries.get(admission);
    if (!entry) {
      let active = true;
      const feed = client.observeEvents([
        "bot.updated",
        "chat.updated",
        "chat.transcript.appended",
      ]);
      const unsubscribe = feed.subscribe({
        snapshot: (snapshot) => {
          if (active && isCurrent()) observer.snapshot(snapshot);
        },
        update: (event) => {
          if (active && isCurrent()) observer.update(event);
        },
      });
      entry = {
        users: 0,
        release: () => {
          active = false;
          unsubscribe();
          void feed.release().catch(() => undefined);
        },
      };
      entries.set(admission, entry);
    }
    entry.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.users === 0) {
        entries.delete(admission);
        entry.release();
      }
    };
  };
}

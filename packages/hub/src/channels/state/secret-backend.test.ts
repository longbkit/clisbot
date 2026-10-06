// Every upsert re-encrypts a whole namespace, so a burst of mutations must cost
// one write — the WhatsApp auth snapshot is written as several entries at once.
import assert from "node:assert/strict";
import { it } from "vitest";
import type { StoredEntry } from "./keyed-store.js";
import {
  openChannelSecretStateBackend,
  type ChannelSecretStateDatabase,
} from "./secret-backend.js";

const SCOPE = { organizationId: "org", channel: "whatsapp", accountId: "main" } as const;

function recordingDatabase() {
  const writes: Array<{ namespace: string; keys: string[] }> = [];
  // While held, the first write waits for `release`.
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  const database: ChannelSecretStateDatabase = {
    loadChannelStateSecrets: async () => [],
    saveChannelStateSecret: async (input) => {
      writes.push({
        namespace: input.namespace,
        keys: (input.entries as StoredEntry[]).map((e) => e.key),
      });
      const waiting = gate;
      gate = undefined;
      await waiting;
    },
  };
  return {
    database,
    writes,
    hold: () => {
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release: () => open(),
  };
}

const entry = (key: string): StoredEntry => ({ key, value: key, createdAt: 0, expiresAt: null });

it("writes a burst of saves to one namespace as one upsert of the latest entries", async () => {
  const { database, writes } = recordingDatabase();
  const backend = await openChannelSecretStateBackend({ database, scope: SCOPE });
  backend.save("auth", [entry("a")]);
  backend.save("auth", [entry("a"), entry("b")]);
  backend.save("auth", [entry("a"), entry("b"), entry("c")]);
  await backend.flush?.();
  assert.deepEqual(writes, [{ namespace: "auth", keys: ["a", "b", "c"] }]);
});

it("queues a save made while a write is running, and writes it after", async () => {
  const db = recordingDatabase();
  db.hold();
  const backend = await openChannelSecretStateBackend({ database: db.database, scope: SCOPE });
  backend.save("auth", [entry("a")]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The first upsert is in flight: these two share the next one.
  backend.save("auth", [entry("a"), entry("b")]);
  backend.save("auth", [entry("a"), entry("b"), entry("c")]);
  db.release();
  await backend.flush?.();
  assert.deepEqual(
    db.writes.map((write) => write.keys),
    [["a"], ["a", "b", "c"]],
  );
});

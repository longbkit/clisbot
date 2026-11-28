// The online indexes on the ingress queue, checked against the SQL the stores
// actually send: a partial index serves a query only while its predicate is the
// query's, so the queries are captured from the stores, not rewritten here.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelInboxStore } from "./channel-inbox.js";
import {
  CHANNEL_INGRESS_ONLINE_INDEXES,
  ensureChannelIngressIndexes,
} from "./channel-ingress-indexes.js";
import { ChannelStore } from "./channels.js";
import {
  embeddedDatabaseRuntime,
  type DatabaseRuntime,
  type DrizzleHandle,
} from "./runtime/index.js";
import * as schema from "./schema.js";

const SCOPE = {
  organizationId: "index-org",
  channel: "slack",
  accountId: "work",
  bindingKey: "binding",
};

let dataDirectory: string;
let client: PGlite;
let captured: { query: string; params: unknown[] }[] = [];
let database: DrizzleHandle;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-ingress-indexes-"));
  const { runtime } = await embeddedDatabaseRuntime(dataDirectory);
  await runtime.migrate();
  await runtime.query(`insert into organization (id, name, slug) values ($1, $1, $1)`, [
    SCOPE.organizationId,
  ]);
  const built: string[] = [];
  await ensureChannelIngressIndexes(runtime, { built: ({ index }) => built.push(index) });
  assert.deepEqual(
    built,
    CHANNEL_INGRESS_ONLINE_INDEXES.map(({ name }) => name),
  );
  // A second start finds them all.
  const again: string[] = [];
  await ensureChannelIngressIndexes(runtime, { built: ({ index }) => again.push(index) });
  assert.deepEqual(again, []);
  await runtime.close();
  client = new PGlite(dataDirectory);
  // Enough rows of the shapes the queries skip that a scan would be the wrong plan.
  await client.query(
    `insert into channel_ingress_queue (organization_id, channel, account_id, external_event_id,
       external_message_id, external_conversation_id, external_thread_id, lane_key, payload,
       status, completed_at, binding_key, inbox_state)
     select $1, $2, $3, 'e' || g, 'e' || g, 'c', 't', 'l', '{}'::jsonb, 'completed', now(),
       $4, case when g % 2 = 0 then 'context' else 'delivered' end
     from generate_series(1, 3000) g`,
    [SCOPE.organizationId, SCOPE.channel, SCOPE.accountId, SCOPE.bindingKey],
  );
  await client.exec("analyze channel_ingress_queue");
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  database = drizzle(client, {
    schema,
    logger: { logQuery: (query, params) => captured.push({ query, params }) },
  }) as unknown as DrizzleHandle;
}, 60_000);

afterAll(async () => {
  await client?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** The plan for the last query a store sent, with sequential scans priced out. */
async function planOfLastQuery(): Promise<string> {
  const last = captured.at(-1);
  assert.ok(last !== undefined, "the store sent a query");
  await client.exec("set enable_seqscan = off");
  const plan = await client.query<{ "QUERY PLAN": string }>(`explain ${last.query}`, last.params);
  await client.exec("reset enable_seqscan");
  return plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("the ingress queue's online indexes", () => {
  it("serve the held-binding scan a start runs for every account", async () => {
    captured = [];
    await new ChannelInboxStore(database).listHeldBindings(SCOPE);
    assert.match(await planOfLastQuery(), /channel_ingress_queue_held_idx/);
  });

  it("serve the check whether a thread snapshot already reached a session", async () => {
    captured = [];
    const anyRow = await client.query<{ id: string }>(
      "select id from channel_ingress_queue limit 1",
    );
    await new ChannelInboxStore(database).threadContextSentTo(
      SCOPE,
      "agent-1",
      "t",
      anyRow.rows[0]!.id,
    );
    assert.match(await planOfLastQuery(), /channel_ingress_queue_thread_context_idx/);
  });

  it("serve the retention sweep's batches of expired completed rows", async () => {
    captured = [];
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const store = new ChannelStore({ drizzle: () => database } as unknown as DatabaseRuntime);
    await store.pruneChannelIngress({
      organizationId: SCOPE.organizationId,
      completedOlderThan: new Date(0),
      limit: 10,
    });
    const batch = captured.find(({ query }) => query.startsWith("delete"));
    assert.ok(batch !== undefined);
    captured.push(batch);
    assert.match(await planOfLastQuery(), /channel_ingress_queue_completed_idx/);
  });
});

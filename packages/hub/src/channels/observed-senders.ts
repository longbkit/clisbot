// The people who have messaged one bot and are not linked to a Hub Member: the
// choices behind a Route's "senders outside the Hub"
// (docs/audits/2026-09-19-route-audience-rules.md). Read-only over the ingress
// queue, which holds every inbound message, admitted or refused, until
// retention prunes it (`ingress/retention.ts`). No provider directory is polled.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { channelConnectionIdentityRealm } from "../access/channel-identity-realm.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";

export interface ObservedChannelSender {
  /** The provider's own sender id. */
  id: string;
  /** What a Route's `who.identities` stores: `<channel>:<id>`. */
  identity: string;
  name: string | null;
  username: string | null;
  lastSeenAt: Date;
}

const READ_LIMIT = 1_000;
const RESULT_LIMIT = 200;

export async function listObservedUnlinkedSenders(
  runtime: DatabaseRuntime,
  input: { organizationId: string; channel: string; accountId: string; connectionId: string },
): Promise<ObservedChannelSender[]> {
  const senders = await recentSenders(runtime, input);
  const linked = await linkedSubjects(
    runtime,
    input,
    senders.map(({ id }) => id),
  );
  return senders.filter(({ id }) => !linked.has(id)).slice(0, RESULT_LIMIT);
}

/** Distinct senders, newest first; the newest message that names one wins. */
async function recentSenders(
  runtime: DatabaseRuntime,
  input: { organizationId: string; channel: string; accountId: string },
): Promise<ObservedChannelSender[]> {
  const queue = schema.channelIngressQueue;
  const field = (name: string) =>
    sql<string | null>`${queue.payload} #>> ${sql.raw(`'{ctxPayload,${name}}'`)}`;
  const rows = await runtime
    .drizzle()
    .select({
      id: field("SenderId"),
      name: field("SenderName"),
      username: field("SenderUsername"),
      createdAt: queue.createdAt,
    })
    .from(queue)
    .where(
      and(
        eq(queue.organizationId, input.organizationId),
        eq(queue.channel, input.channel),
        eq(queue.accountId, input.accountId),
      ),
    )
    .orderBy(desc(queue.createdAt))
    .limit(READ_LIMIT);
  const senders = new Map<string, ObservedChannelSender>();
  for (const row of rows) {
    if (row.id === null || row.id === "") continue;
    const current = senders.get(row.id);
    if (current === undefined) {
      senders.set(row.id, {
        id: row.id,
        identity: `${input.channel}:${row.id}`,
        name: row.name,
        username: row.username,
        lastSeenAt: row.createdAt,
      });
      continue;
    }
    current.name ??= row.name;
    current.username ??= row.username;
  }
  return [...senders.values()];
}

/** The sender ids already linked to a Member in this bot's identity realm. */
async function linkedSubjects(
  runtime: DatabaseRuntime,
  input: { organizationId: string; channel: string; connectionId: string },
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const database = runtime.drizzle();
  const realm = await channelConnectionIdentityRealm(
    database,
    input.organizationId,
    input.connectionId,
    input.channel,
  );
  if (realm === undefined) return new Set();
  const identities = schema.channelIdentities;
  const rows = await database
    .select({ id: identities.externalSubjectId })
    .from(identities)
    .where(
      and(
        eq(identities.organizationId, input.organizationId),
        eq(identities.identityRealm, realm),
        inArray(identities.externalSubjectId, [...ids]),
      ),
    );
  return new Set(rows.map(({ id }) => id));
}

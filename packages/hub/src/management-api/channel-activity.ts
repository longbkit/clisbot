import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ProductRequestError } from "../auth/organization-access.js";
import { requireChannelPlane } from "./channel-plane-gate.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { auditEvents } from "../db/schema.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import { SupportedChannelNameSchema } from "../channels/config/enums.js";

// `denied` is the access gate's own outcome (`access.dmPolicy` / `groupPolicy`
// / `allowFrom`): a sender refused before any turn, with the upstream reason
// code in `outcomeDetail`. It is distinct from `ignored`, which means the plane
// had nothing to do with the event.
const outcomeSchema = z.enum(["bound", "steered", "workflow", "ignored", "denied", "error"]);
const routeSchema = z.union([z.number().int().nonnegative(), z.literal("fallback")]);
const activityEvidence = z.object({
  routePosition: routeSchema,
  conversationId: z.string(),
  threadId: z.string().nullable(),
  providerSenderId: z.string(),
  outcome: outcomeSchema,
  outcomeDetail: z.string().optional(),
  limitDecision: z.enum(["not_evaluated", "allowed", "denied"]),
  limitReason: z.string().optional(),
});
const querySchema = z
  .object({
    channel: SupportedChannelNameSchema.optional(),
    accountId: z.string().min(1).max(512).optional(),
    routePosition: z
      .union([
        z.literal("fallback"),
        z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()),
      ])
      .optional(),
    outcome: outcomeSchema.optional(),
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((value) => !value.accountId || value.channel !== undefined)
  .refine((value) => value.routePosition === undefined || value.accountId !== undefined);
const cursorSchema = z.object({
  at: z.string().datetime(),
  id: z.string().uuid(),
  scope: z.string(),
});
export type ChannelActivityQuery = z.infer<typeof querySchema>;

export function parseChannelActivityQuery(params: URLSearchParams): ChannelActivityQuery {
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new ProductRequestError(400, "invalid_channel_activity_query");
  return parsed.data;
}

function readCursor(query: ChannelActivityQuery, scope: string) {
  if (!query.cursor) return undefined;
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
    );
    if (cursor.scope !== scope) throw new Error("Cursor belongs to another query");
    return cursor;
  } catch {
    throw new ProductRequestError(400, "invalid_channel_activity_cursor");
  }
}

/** One page of channel activity. Gated: with the kill-switch off this Hub has
 * no channel plane, so the resource does not exist. */
export async function channelActivityPage(
  runtime: DatabaseRuntime,
  organizationId: string,
  query: ChannelActivityQuery,
) {
  requireChannelPlane();
  const scope = JSON.stringify([
    organizationId,
    query.channel,
    query.accountId,
    query.routePosition,
    query.outcome,
  ]);
  const cursor = readCursor(query, scope);
  const rows = await runtime
    .drizzle()
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      // Keep PostgreSQL microseconds in the cursor; JS Date truncates them and skips rows.
      cursorAt: sql<string>`to_char(${auditEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      subjectId: auditEvents.subjectId,
      evidence: auditEvents.evidence,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        eq(auditEvents.action, "channel.inbound.processed"),
        eq(auditEvents.subjectType, "channel_account"),
        query.accountId !== undefined
          ? eq(auditEvents.subjectId, `${query.channel}/${query.accountId}`)
          : undefined,
        query.channel !== undefined && query.accountId === undefined
          ? sql`split_part(${auditEvents.subjectId}, '/', 1) = ${query.channel}`
          : undefined,
        query.routePosition !== undefined
          ? sql`${auditEvents.evidence}->>'routePosition' = ${String(query.routePosition)}`
          : undefined,
        query.outcome !== undefined
          ? sql`${auditEvents.evidence}->>'outcome' = ${query.outcome}`
          : undefined,
        cursor
          ? sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(sql`${auditEvents.createdAt} DESC NULLS LAST`, sql`${auditEvents.id} DESC NULLS LAST`)
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    activity: page.flatMap((row) => {
      const evidence = activityEvidence.safeParse(row.evidence);
      const separator = row.subjectId.indexOf("/");
      const channel = SupportedChannelNameSchema.safeParse(row.subjectId.slice(0, separator));
      const accountId = row.subjectId.slice(separator + 1);
      return evidence.success && channel.success && accountId.length > 0
        ? [
            {
              id: row.id,
              createdAt: row.createdAt.toISOString(),
              channel: channel.data,
              accountId,
              ...evidence.data,
            },
          ]
        : [];
    }),
    // Advance over malformed legacy rows too; they must not hide later valid history.
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.id, scope })).toString(
            "base64url",
          )
        : null,
  };
}

export function channelActivityView(
  runtime: DatabaseRuntime,
  organizationId: string,
  channel: SupportedChannelName,
  accountId: string,
) {
  return channelActivityPage(runtime, organizationId, { channel, accountId, limit: 50 });
}

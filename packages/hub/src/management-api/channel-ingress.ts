/**
 * Operator operations over the durable channel ingress queue, for the
 * organization-scoped management contract (`channel-ingress`). Every function
 * takes the organization id the caller was authorized for and passes it to the
 * store, so a request can only ever see or move its own organization's rows.
 *
 * Wire names (docs/rpc-namespacing.md reads as `hub.channels.ingress.*`; the
 * Hub's operator surface is this REST contract, not a socket RPC):
 *   status   GET  /organizations/:id/channel-ingress
 *   list     GET  /organizations/:id/channel-ingress/events
 *   resubmit POST /organizations/:id/channel-ingress/resubmit
 *   prune    POST /organizations/:id/channel-ingress/prune
 *
 * Every operation is behind the channel kill-switch (`channel-plane-gate.ts`):
 * a Hub that runs no channel plane owns no queue to read or move, and `prune`
 * and `resubmit` mutate durable rows.
 */
import { z } from "zod";
import { ProductRequestError } from "../auth/organization-access.js";
import { requireChannelPlane } from "./channel-plane-gate.js";
import { ChannelStore } from "../db/channels.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { CHANNEL_INGRESS_QUEUE_STATUSES } from "../db/schema.js";
import {
  channelIngressAccountKey,
  channelIngressEntryView,
  channelIngressHealth,
  channelIngressHealthByAccount,
  type ChannelIngressAccountHealth,
  type ChannelIngressEntryView,
  type ChannelIngressHealth,
} from "../channels/ingress/health.js";
import type { ChannelAccountStatusEntry } from "../channels/supervisor/types.js";
import { CHANNEL_INGRESS_RETENTION_DEFAULTS } from "../channels/ingress/retention.js";

const MAX_PAGE = 200;

/** The queue facts attached to one account's runtime status entry. */
export type ChannelAccountIngressStatus = Omit<
  ChannelIngressAccountHealth,
  "channel" | "accountId" | "completed"
>;

export type ChannelAccountStatusWithIngress = ChannelAccountStatusEntry & {
  ingress?: ChannelAccountIngressStatus;
};

const listQuerySchema = z
  .object({
    channel: z.string().min(1).max(64).optional(),
    accountId: z.string().min(1).max(512).optional(),
    status: z.enum(CHANNEL_INGRESS_QUEUE_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  // An account id without its channel is ambiguous: two channels can both
  // carry an account called `support`.
  .refine((value) => value.accountId === undefined || value.channel !== undefined);

export const channelIngressResubmitBodySchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(MAX_PAGE) })
  .strict();

/** The floor under `completedOlderThanMs`. A completed row is the replay guard
 * for its provider event, so a cutoff of zero deletes the guard for events the
 * provider is still retrying and re-admits them as new inbound. */
export const MIN_COMPLETED_PRUNE_AGE_MS = 60 * 60 * 1_000;

/** An absent cutoff falls back to the retention sweep's TTL for that status. */
export const channelIngressPruneBodySchema = z
  .object({
    completedOlderThanMs: z.number().int().min(MIN_COMPLETED_PRUNE_AGE_MS).optional(),
    deadLetteredOlderThanMs: z.number().int().min(0).optional(),
  })
  .strict()
  .default({});

export type ChannelIngressListQuery = z.infer<typeof listQuerySchema>;

export function parseChannelIngressListQuery(params: URLSearchParams): ChannelIngressListQuery {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new ProductRequestError(400, "invalid_channel_ingress_query");
  return parsed.data;
}

/**
 * Per-account runtime status, with the account's queue depth attached. The
 * queue outlives a transport, so an account whose transport is stopped still
 * reports its backlog here.
 */
export function withChannelIngressHealth(
  entries: readonly ChannelAccountStatusEntry[],
  health: ChannelIngressHealth,
): ChannelAccountStatusWithIngress[] {
  const byAccount = channelIngressHealthByAccount(health);
  const merged: ChannelAccountStatusWithIngress[] = [];
  for (const entry of entries) {
    const account = byAccount.get(channelIngressAccountKey(entry.channel, entry.account));
    if (account === undefined) {
      merged.push(entry);
      continue;
    }
    merged.push({
      ...entry,
      ingress: {
        pending: account.pending,
        claimed: account.claimed,
        retrying: account.retrying,
        deadLettered: account.deadLettered,
        oldestPendingAgeMs: account.oldestPendingAgeMs,
        lanesBlocked: account.lanesBlocked,
      },
    });
  }
  return merged;
}

/** `hub.channels.ingress.status`: queue depth per account plus the org total. */
export function channelIngressStatusView(
  runtime: DatabaseRuntime,
  organizationId: string,
  now?: Date,
): Promise<ChannelIngressHealth> {
  requireChannelPlane();
  return channelIngressHealth(new ChannelStore(runtime), organizationId, now);
}

export interface ChannelIngressListPage {
  events: ChannelIngressEntryView[];
  /** Offset of the next page, or null when this page is the last one. */
  nextOffset: number | null;
}

/** `hub.channels.ingress.list`: one redacted page of the organization's rows. */
export async function channelIngressListPage(
  runtime: DatabaseRuntime,
  organizationId: string,
  query: ChannelIngressListQuery,
): Promise<ChannelIngressListPage> {
  requireChannelPlane();
  // One extra row decides whether a next page exists without a second count.
  const rows = await new ChannelStore(runtime).listChannelIngress({
    organizationId,
    ...(query.channel === undefined ? {} : { channel: query.channel }),
    ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
    ...(query.status === undefined ? {} : { statuses: [query.status] }),
    limit: query.limit + 1,
    offset: query.offset,
  });
  return {
    events: rows.slice(0, query.limit).map(channelIngressEntryView),
    nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
  };
}

/** `hub.channels.ingress.resubmit`: reopen dead-lettered rows as pending. */
export async function channelIngressResubmit(
  runtime: DatabaseRuntime,
  organizationId: string,
  ids: readonly string[],
): Promise<{ resubmitted: ChannelIngressEntryView[] }> {
  requireChannelPlane();
  const rows = await new ChannelStore(runtime).resubmitChannelIngress({ organizationId, ids });
  return { resubmitted: rows.map(channelIngressEntryView) };
}

/** `hub.channels.ingress.prune`: the retention sweep, run now, on demand. */
export async function channelIngressPrune(
  runtime: DatabaseRuntime,
  organizationId: string,
  body: z.infer<typeof channelIngressPruneBodySchema>,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  requireChannelPlane();
  const completedTtlMs =
    body.completedOlderThanMs ?? CHANNEL_INGRESS_RETENTION_DEFAULTS.completedTtlMs;
  const deadLetteredTtlMs =
    body.deadLetteredOlderThanMs ?? CHANNEL_INGRESS_RETENTION_DEFAULTS.deadLetteredTtlMs;
  const deleted = await new ChannelStore(runtime).pruneChannelIngress({
    organizationId,
    completedOlderThan: new Date(now.getTime() - completedTtlMs),
    deadLetteredOlderThan: new Date(now.getTime() - deadLetteredTtlMs),
  });
  return { deleted };
}

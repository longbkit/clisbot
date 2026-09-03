import { and, desc, eq, sql } from "drizzle-orm";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type { P0ChannelName } from "./plane/types.js";
import { ChannelWorkflowPayloadSchema } from "../triggers/channel/provider.js";

export const CHANNEL_CONVERSATION_KINDS = ["dm", "channel", "thread", "group", "topic"] as const;

export type ChannelConversationKind = (typeof CHANNEL_CONVERSATION_KINDS)[number];

/**
 * A provider-neutral Conversation observed by the existing Channel runtime.
 * `id` is the exact value authored in a Route match. The root and thread ids
 * stay separate so the UI can present a thread/topic under its parent without
 * changing the existing matching semantics.
 */
export interface ObservedChannelConversation {
  id: string;
  kind: ChannelConversationKind;
  rootConversationId: string;
  threadId: string | null;
  label: string | null;
  visibility: "public" | "private" | "unknown";
  observedAt: Date;
}

interface ConversationFact {
  channel: P0ChannelName;
  rootConversationId: string;
  threadId: string | null;
  rootKind: "dm" | "channel" | "group";
  label: string | null;
  observedAt: Date;
}

const READ_LIMIT = 500;
const RESULT_LIMIT = 200;

/**
 * Read-only projection over durable Channel artifacts. Direct-Agent traffic
 * already creates thread bindings; Workflow traffic already creates Channel
 * provider receipts. No provider directory polling or second writable
 * configuration store is introduced.
 */
export async function listObservedChannelConversations(
  runtime: DatabaseRuntime,
  input: {
    organizationId: string;
    channel: P0ChannelName;
    accountId: string;
  },
): Promise<ObservedChannelConversation[]> {
  const database = runtime.drizzle();
  const [bindings, receipts] = await Promise.all([
    database
      .select({
        externalConversationId: schema.threadBindings.externalConversationId,
        externalThreadId: schema.threadBindings.externalThreadId,
        route: schema.threadBindings.route,
        createdAt: schema.threadBindings.createdAt,
      })
      .from(schema.threadBindings)
      .where(
        and(
          eq(schema.threadBindings.organizationId, input.organizationId),
          eq(schema.threadBindings.channel, input.channel),
          eq(schema.threadBindings.accountId, input.accountId),
        ),
      )
      .orderBy(desc(schema.threadBindings.createdAt))
      .limit(READ_LIMIT),
    database
      .select({
        payload: schema.providerEventReceipts.payload,
        receivedAt: schema.providerEventReceipts.receivedAt,
      })
      .from(schema.providerEventReceipts)
      .where(
        and(
          eq(schema.providerEventReceipts.organizationId, input.organizationId),
          eq(schema.providerEventReceipts.provider, "channel"),
          sql`${schema.providerEventReceipts.payload} #>> '{channel,name}' = ${input.channel}`,
          sql`${schema.providerEventReceipts.payload} #>> '{channel,account_id}' = ${input.accountId}`,
        ),
      )
      .orderBy(desc(schema.providerEventReceipts.receivedAt))
      .limit(READ_LIMIT),
  ]);

  const facts: ConversationFact[] = [];
  for (const row of bindings) {
    const summary = storedConversationSummary(row.route);
    if (summary === null) continue;
    facts.push({
      channel: input.channel,
      rootConversationId: row.externalConversationId,
      threadId: row.externalThreadId,
      rootKind: rootKind(summary.kind),
      label: summary.label,
      observedAt: row.createdAt,
    });
  }
  for (const row of receipts) {
    const payload = ChannelWorkflowPayloadSchema.safeParse(row.payload);
    if (!payload.success) continue;
    const channel = payload.data.channel;
    facts.push({
      channel: channel.name,
      rootConversationId: channel.external_conversation_id,
      threadId: channel.external_thread_id,
      rootKind: channel.root_kind,
      label: channel.conversation_label ?? null,
      observedAt: row.receivedAt,
    });
  }
  return projectFacts(facts).slice(0, RESULT_LIMIT);
}

function projectFacts(facts: readonly ConversationFact[]): ObservedChannelConversation[] {
  const projected = new Map<string, ObservedChannelConversation>();
  for (const fact of facts.toSorted(
    (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
  )) {
    addObservation(projected, {
      id: fact.rootConversationId,
      kind: fact.rootKind,
      rootConversationId: fact.rootConversationId,
      threadId: null,
      label: fact.label,
      visibility: fact.rootKind === "dm" ? "private" : "unknown",
      observedAt: fact.observedAt,
    });
    if (fact.threadId === null) continue;
    addObservation(projected, {
      id: fact.threadId,
      kind: fact.channel === "slack" ? "thread" : "topic",
      rootConversationId: fact.rootConversationId,
      threadId: fact.threadId,
      label: fact.label,
      visibility: fact.rootKind === "dm" ? "private" : "unknown",
      observedAt: fact.observedAt,
    });
  }
  return [...projected.values()].toSorted(
    (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
  );
}

function addObservation(
  observations: Map<string, ObservedChannelConversation>,
  observation: ObservedChannelConversation,
): void {
  const key = `${observation.kind}\0${observation.id}`;
  const current = observations.get(key);
  if (current === undefined) {
    observations.set(key, observation);
    return;
  }
  if (current.label === null && observation.label !== null) {
    observations.set(key, { ...current, label: observation.label });
  }
}

function storedConversationSummary(
  stored: unknown,
): { kind: ChannelConversationKind; label: string | null } | null {
  if (typeof stored !== "object" || stored === null) return null;
  const match = Reflect.get(stored, "match");
  if (typeof match !== "object" || match === null) return null;
  const kind = Reflect.get(match, "kind");
  if (!isConversationKind(kind)) return null;
  const label = Reflect.get(stored, "conversationLabel");
  return {
    kind,
    label: typeof label === "string" && label.trim().length > 0 ? label.trim().slice(0, 200) : null,
  };
}

function isConversationKind(value: unknown): value is ChannelConversationKind {
  return (
    typeof value === "string" && (CHANNEL_CONVERSATION_KINDS as readonly string[]).includes(value)
  );
}

function rootKind(kind: ChannelConversationKind): "dm" | "channel" | "group" {
  if (kind === "thread") return "channel";
  if (kind === "topic") return "group";
  return kind;
}

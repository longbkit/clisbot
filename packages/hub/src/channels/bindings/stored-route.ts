// What identifies a binding row and what it records about the route that bound
// it (§4.3.4): the durable thread key, and the summary written on bind — the
// conversation the route matched, the target the session was minted at, and
// the revision/position/fingerprint kept as provenance. Pure projection: the
// engine (`index.ts`) decides, this file only derives the key and writes/reads
// the row's `route` blob.
//
// Two readers carry decisions and they are the only ones that do:
// `parseStoredRouteSummary` gives the conversation to re-match the route on,
// and `parseStoredRouteTarget` gives the target to compare it against.

import { createHash } from "node:crypto";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { InboundConversation } from "../policy.js";
import {
  SLACK_THREAD_TS_PATTERN,
  type InboundConversationDetail,
  type InboundMessage,
} from "../plane/types.js";

export interface StoredRouteSummary {
  /** The original route-match descriptor (`kind` + native id). */
  match: { kind: InboundConversationDetail["kind"]; id: string };
  target: CompiledRoute["target"];
  bindingKey: EffectiveDefaults["bindingKey"];
  replyAnchor: EffectiveDefaults["replyAnchor"];
  /** Human label observed at admission; display-only and never an access key. */
  conversationLabel?: string;
  /** Provenance of the bind — which revision and which route position minted
   * this session, and that route's content hash. Recorded for operators
   * reading rows back; no routing decision reads it. */
  selection?: {
    revisionId: string | null;
    position: number | "fallback";
    fingerprint: string;
  };
}

export function bindingSummary(
  route: CompiledRoute,
  conversation: InboundConversationDetail,
  selection?: { revisionId: string | null; position: number | "fallback" },
  conversationLabel?: string,
): StoredRouteSummary {
  // The route may have matched a thread message at its root-level descriptor;
  // store the level the route declares, not necessarily the inbound's most
  // specific level. Fallbacks use the root descriptor.
  const atInboundLevel = route.match.kind === conversation.kind;
  const match = atInboundLevel
    ? { kind: conversation.kind, id: conversation.id }
    : {
        kind: rootKind(conversation.kind),
        id: conversation.rootConversationId,
      };
  const safeConversationLabel = conversationLabel?.trim().slice(0, 200);
  return {
    match,
    target: route.target,
    bindingKey: route.defaults.bindingKey,
    replyAnchor: route.defaults.replyAnchor,
    ...(safeConversationLabel ? { conversationLabel: safeConversationLabel } : {}),
    ...(selection === undefined
      ? {}
      : {
          selection: {
            revisionId: selection.revisionId,
            position: selection.position,
            fingerprint: routeFingerprint(route),
          },
        }),
  };
}

/** Internal position of a compiled route inside one immutable account revision. */
export function routePosition(
  account: CompiledChannelAccount,
  route: CompiledRoute,
): number | "fallback" {
  const position = account.routes.indexOf(route);
  return position < 0 ? "fallback" : position;
}

/** Content hash of a compiled route: provenance on a binding row, and the
 * route stamp a reply capability carries. */
export function routeFingerprint(route: CompiledRoute): string {
  return createHash("sha256").update(JSON.stringify(route)).digest("base64url");
}

/** Parsed captured selection; undefined for a legacy or malformed row. */
export function parseStoredRouteSelection(
  stored: unknown,
): StoredRouteSummary["selection"] | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const selection = (stored as { selection?: unknown }).selection;
  if (typeof selection !== "object" || selection === null) return undefined;
  const revisionId = (selection as { revisionId?: unknown }).revisionId;
  const position = (selection as { position?: unknown }).position;
  const fingerprint = (selection as { fingerprint?: unknown }).fingerprint;
  if (revisionId !== null && typeof revisionId !== "string") return undefined;
  if (position !== "fallback" && (!Number.isInteger(position) || Number(position) < 0)) {
    return undefined;
  }
  if (typeof fingerprint !== "string" || fingerprint.length === 0) return undefined;
  return {
    revisionId: revisionId as string | null,
    position: position as number | "fallback",
    fingerprint,
  };
}

/**
 * The target the bound session was minted at. The plane compares it with the
 * target of the route that owns the conversation now: same target = keep the
 * session, different target = the conversation goes somewhere else and needs a
 * new one. `undefined` for a row written before targets were summarized.
 */
export function parseStoredRouteTarget(stored: unknown): CompiledRoute["target"] | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const target = (stored as { target?: unknown }).target;
  if (typeof target !== "object" || target === null) return undefined;
  const kind = (target as { kind?: unknown }).kind;
  if (kind === "workflow") {
    const workflow = (target as { workflow?: unknown }).workflow;
    return typeof workflow === "string" ? { kind: "workflow", workflow } : undefined;
  }
  if (kind !== "agent") return undefined;
  const agent = (target as { agent?: unknown }).agent;
  const environment = (target as { environment?: unknown }).environment;
  const template = (target as { template?: unknown }).template;
  if (typeof agent !== "string" || typeof environment !== "string") return undefined;
  return {
    kind: "agent",
    agent,
    environment,
    template: typeof template === "string" ? template : null,
  };
}

/** The route-match descriptor the facade re-matches on re-attach; undefined when
 * the row carries no summary (or a malformed one). */
export function parseStoredRouteSummary(stored: unknown): InboundConversation | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const match = (stored as { match?: unknown }).match;
  if (typeof match !== "object" || match === null) return undefined;
  const kind = (match as { kind?: unknown }).kind;
  const id = (match as { id?: unknown }).id;
  if (typeof kind !== "string" || typeof id !== "string") return undefined;
  return { kind: kind as InboundConversationDetail["kind"], id };
}

function rootKind(kind: InboundConversationDetail["kind"]): "dm" | "channel" | "group" {
  if (kind === "thread") return "channel";
  if (kind === "topic") return "group";
  return kind;
}

/** The durable thread key (conversation + native thread id) a binding is keyed by. */
export interface ThreadKey {
  externalConversationId: string;
  externalThreadId: string | null;
}

/**
 * Derive the thread key a message binds to, per `binding.key` (§4.3.4).
 * `thread`: the native thread/topic is the unit — conversation + thread id (a
 * top-level channel message has no thread id and falls to the conversation
 * level, matching every channel's native "no thread = channel session" rule).
 * `channel` / `dm`: the whole conversation is one session; threads collapse.
 *
 * One exception — the minted-thread key: under `reply.anchor: thread` a
 * root-level Slack marker mints its reply thread on the marker message itself
 * (`thread_ts` = the marker's native ts, the relay's mint), so the marker is
 * already the root of a real thread. It binds at THAT thread's key, not the
 * conversation level: the marker's turn and the thread's follow-ups share one
 * session, two root markers never share one, and the minted thread never
 * re-binds a second session on its first reply.
 */
export function deriveBindingKey(message: InboundMessage, route: CompiledRoute): ThreadKey {
  const conversation = message.conversation;
  let externalThreadId = route.defaults.bindingKey === "thread" ? conversation.threadId : null;
  if (
    externalThreadId === null &&
    route.defaults.bindingKey === "thread" &&
    route.defaults.replyAnchor === "thread" &&
    message.channel === "slack" &&
    conversation.kind !== "dm" &&
    message.externalMessageId !== undefined &&
    SLACK_THREAD_TS_PATTERN.test(message.externalMessageId)
  ) {
    externalThreadId = message.externalMessageId;
  }
  return {
    externalConversationId: conversation.rootConversationId,
    externalThreadId,
  };
}

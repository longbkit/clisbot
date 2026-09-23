// What identifies a binding row and what it records about the route that bound
// it (§4.3.4): the durable thread key, and the summary written on bind — the
// conversation the route matched, the target the session was minted at, and
// the revision/position/fingerprint kept as provenance. Pure projection: the
// engine (`index.ts`) decides, this file only derives the key and writes/reads
// the row's `route` blob.
//
// Three readers carry decisions and they are the only ones that do:
// `parseStoredRouteSummary` gives the conversation to re-match the route on,
// `storedRouteOwner` picks the Route the bound conversation stays with, and
// `parseStoredRouteTarget` gives the target to compare it against.

import { createHash } from "node:crypto";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { routeConversationMatches, type InboundConversation } from "../policy.js";
import type { ThreadBindingRecord } from "../../db/types.js";
import {
  SLACK_THREAD_TS_PATTERN,
  type InboundConversationDetail,
  type InboundMessage,
} from "../plane/types.js";

export interface StoredRouteSummary {
  /** The conversation the route was matched on: its own level (`kind` + native id),
   * the room it belongs to, and the visibility the vertical reported —
   * everything a Route's Where is decided on. */
  match: {
    kind: InboundConversationDetail["kind"];
    id: string;
    rootConversationId?: string;
    visibility?: "public" | "private";
  };
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
    position: number;
    fingerprint: string;
  };
}

/** Make an existing Agent Route serve one explicitly selected conversation. */
export function dynamicProjectRoute(
  route: CompiledRoute,
  conversation: InboundConversation,
  projectId: string,
  projectRoot: string,
  projectDaemonReference?: string | null,
): CompiledRoute {
  const conversations = [conversation.id, conversation.rootConversationId ?? conversation.id];
  return {
    ...route,
    where: { ...route.where, conversations },
    target:
      route.target.kind === "agent"
        ? {
            ...route.target,
            projectId,
            projectRoot,
            ...(projectDaemonReference == null ? {} : { projectDaemonReference }),
          }
        : route.target,
  };
}

export function bindingSummary(
  route: CompiledRoute,
  conversation: InboundConversationDetail,
  selection?: { revisionId: string | null; position: number },
  conversationLabel?: string,
): StoredRouteSummary {
  const match = {
    kind: conversation.kind,
    id: conversation.id,
    rootConversationId: conversation.rootConversationId,
    ...(conversation.visibility === undefined ? {} : { visibility: conversation.visibility }),
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

/** Internal position of a compiled Route, or its dynamic template. */
export function routePosition(account: CompiledChannelAccount, route: CompiledRoute): number {
  const direct = account.routes.indexOf(route);
  if (direct >= 0) return direct;
  const target = route.target;
  if (target.kind === "agent" && target.projectId !== undefined) {
    const template = account.routes.findIndex((candidate) => {
      const candidateTarget = candidate.target;
      return (
        candidateTarget.kind === "agent" &&
        candidateTarget.agent === target.agent &&
        candidateTarget.environment === target.environment
      );
    });
    if (template >= 0) return template;
  }
  throw new Error("route is not one of this account's routes");
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
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) return undefined;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) return undefined;
  return { revisionId: revisionId as string | null, position, fingerprint };
}

/** The target the bound session was minted at, including a dynamic Project. */
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
  const projectId = (target as { projectId?: unknown }).projectId;
  const projectRoot = (target as { projectRoot?: unknown }).projectRoot;
  const projectDaemonReference = (target as { projectDaemonReference?: unknown })
    .projectDaemonReference;
  if (typeof agent !== "string" || typeof environment !== "string") return undefined;
  return {
    kind: "agent",
    agent,
    environment,
    template: typeof template === "string" ? template : null,
    ...(typeof projectId === "string" ? { projectId } : {}),
    ...(typeof projectRoot === "string" ? { projectRoot } : {}),
    ...(typeof projectDaemonReference === "string" ? { projectDaemonReference } : {}),
  };
}

/** The conversation descriptor the facade re-matches on re-attach; undefined
 * when the row carries no summary (or a malformed one). A row written before
 * the room and visibility were recorded reads as its own room. */
export function parseStoredRouteSummary(stored: unknown): InboundConversation | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const match = (stored as { match?: unknown }).match;
  if (typeof match !== "object" || match === null) return undefined;
  const kind = (match as { kind?: unknown }).kind;
  const id = (match as { id?: unknown }).id;
  if (typeof kind !== "string" || typeof id !== "string") return undefined;
  const root = (match as { rootConversationId?: unknown }).rootConversationId;
  const visibility = (match as { visibility?: unknown }).visibility;
  return {
    kind: kind as InboundConversationDetail["kind"],
    id,
    ...(typeof root === "string" ? { rootConversationId: root } : {}),
    ...(visibility === "public" || visibility === "private" ? { visibility } : {}),
  };
}

/**
 * The Route a bound conversation stays with. A bound conversation never falls
 * through by sender (docs/audits/2026-09-19-route-audience-rules.md#routing):
 * among the Routes whose Where still covers the recorded conversation, the one
 * the binding recorded — by content hash while it is unchanged, by position
 * after an edit — and otherwise the first that covers it. No Route covering
 * it → undefined (unserved).
 */
export function storedRouteOwner(
  account: CompiledChannelAccount,
  binding: Pick<ThreadBindingRecord, "route" | "externalConversationId">,
  live?: InboundConversation,
): CompiledRoute | undefined {
  const conversation = live ??
    parseStoredRouteSummary(binding.route) ?? {
      kind: "channel" as const,
      id: binding.externalConversationId,
    };
  const recorded = recordedRoute(account, conversation, parseStoredRouteSelection(binding.route));
  if (recorded !== undefined) return recorded;
  const target = parseStoredRouteTarget(binding.route);
  if (
    target?.kind !== "agent" ||
    target.projectId === undefined ||
    target.projectRoot === undefined
  ) {
    return undefined;
  }
  const template = account.routes.find(
    (route) =>
      route.target.kind === "agent" &&
      route.target.agent === target.agent &&
      route.target.environment === target.environment,
  );
  return template === undefined
    ? undefined
    : dynamicProjectRoute(
        template,
        conversation,
        target.projectId,
        target.projectRoot,
        target.projectDaemonReference,
      );
}

/**
 * The Route a recorded selection still points at: among the Routes whose Where
 * covers the conversation, the recorded one by content hash, then by position,
 * then the first that covers it. Shared by bound conversations and Workflow
 * output so both answer "which Route owns this" the same way.
 */
export function recordedRoute(
  account: CompiledChannelAccount,
  conversation: InboundConversation,
  selection:
    | Pick<NonNullable<StoredRouteSummary["selection"]>, "position" | "fingerprint">
    | undefined,
): CompiledRoute | undefined {
  const covering = account.routes.filter((route) => routeConversationMatches(route, conversation));
  if (selection === undefined) return covering[0];
  const byFingerprint = covering.find((route) => routeFingerprint(route) === selection.fingerprint);
  if (byFingerprint !== undefined) return byFingerprint;
  const byPosition = account.routes[selection.position];
  return byPosition !== undefined && covering.includes(byPosition) ? byPosition : covering[0];
}

/** The durable thread key (conversation + native thread id) a binding is keyed by. */
export interface ThreadKey {
  externalConversationId: string;
  externalThreadId: string | null;
}

/**
 * Does this Route open a thread per root-level message here (the minted-thread
 * key of `deriveBindingKey`)? Then no message binds the conversation root:
 * every root message binds its own thread.
 */
export function rootMessagesOpenThreads(message: InboundMessage, route: CompiledRoute): boolean {
  return (
    route.defaults.bindingKey === "thread" &&
    route.defaults.replyAnchor === "thread" &&
    message.channel === "slack" &&
    message.conversation.kind !== "dm"
  );
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
    rootMessagesOpenThreads(message, route) &&
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

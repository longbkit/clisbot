import { z } from "zod";
import type { SessionActor, SessionAuthorship } from "./session-authorship.js";

/**
 * Which sessions may notify a reader, matching Home: For me / Others / All tabs, and
 * Needs me (`needs`), For me narrowed to what needs the reader. `off` silences every session.
 */
export const NotificationScopeSchema = z.enum(["mine", "needs", "others", "all", "off"]);
export type NotificationScope = z.infer<typeof NotificationScopeSchema>;

/** Every reader starts with For me, including installs that never chose a scope. */
export const DEFAULT_NOTIFICATION_SCOPE: NotificationScope = "mine";

export type NotificationOwnership = "mine" | "others" | "unknown";

/**
 * What the event asks of the reader. `needs` is what Home's Needs me shows unseen: a request
 * waiting for an answer, or a failure (`issues.ts` `currentIssueKind`). Everything else is an
 * `update`, such as a finished turn.
 */
export type NotificationEventKind = "update" | "needs";

/**
 * Who a notification is for, as the daemon knows them.
 *
 * - `actor` is the Hub account the connection was admitted for. Null means the
 *   Host owner's own paired device or local client, which has no Hub identity.
 * - `daemonWide` is true when that reader may use every Project on the Host.
 */
export interface NotificationReader {
  actor: SessionActor | null;
  daemonWide: boolean;
  scope: NotificationScope;
}

/** The evidence a session's ownership is judged by; `parent` is the nearest ancestor. */
export interface NotificationOwnershipEvidence extends Pick<
  SessionAuthorship,
  "createdBy" | "ownerActor" | "lastMessageBy" | "participantActors"
> {
  parent?: NotificationOwnershipEvidence;
}

/** One key per person, so the same reader on two devices is planned once. */
export function notificationReaderKey(actor: SessionActor | null): string {
  if (actor === null) return "host";
  const hub = actor.hubIdentity ?? actor.hubOrigin ?? null;
  return actor.memberId
    ? JSON.stringify(["member", hub, actor.organizationId ?? null, actor.memberId])
    : JSON.stringify(["user", hub, actor.id]);
}

/** A Hub-stamped person: the only actor whose presence can place a session. */
function isVerifiedPerson(actor: SessionActor | null | undefined): actor is SessionActor {
  return actor?.kind === "user" && Boolean(actor.hubOrigin || actor.hubIdentity);
}

function canonicalOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : origin;
  } catch {
    return origin;
  }
}

function sameHub(left: SessionActor, right: SessionActor): boolean {
  if (left.hubIdentity && right.hubIdentity) return left.hubIdentity === right.hubIdentity;
  if (!left.hubOrigin || !right.hubOrigin) return false;
  return canonicalOrigin(left.hubOrigin) === canonicalOrigin(right.hubOrigin);
}

/**
 * Whether `actor` is `reader`. A channel identity (`connectionId`) is a chat
 * platform user, not a Hub user id: only its verified Member link can match.
 */
function isReader(actor: SessionActor, reader: SessionActor): boolean {
  if (!sameHub(actor, reader)) return false;
  if (actor.connectionId && (!actor.memberId || !reader.memberId)) return false;
  if (actor.memberId && reader.memberId) return actor.memberId === reader.memberId;
  return actor.id === reader.id;
}

function namesVerifiedPerson(evidence: NotificationOwnershipEvidence): boolean {
  return [
    evidence.createdBy,
    evidence.ownerActor,
    evidence.lastMessageBy,
    ...(evidence.participantActors ?? []),
  ].some(isVerifiedPerson);
}

/**
 * The For me / Others rule of the session list (docs/features/navigation-v2),
 * judged for one reader. A scheduled or automated creation counts its verified
 * `ownerActor` as the creator; a session that names no verified person, such as
 * a subagent, is its nearest ancestor's.
 */
export function notificationOwnership(
  reader: SessionActor,
  evidence: NotificationOwnershipEvidence,
): NotificationOwnership {
  if (!namesVerifiedPerson(evidence)) {
    return evidence.parent ? notificationOwnership(reader, evidence.parent) : "unknown";
  }
  const creator = [evidence.createdBy, evidence.ownerActor].find(isVerifiedPerson);
  const participants = [evidence.lastMessageBy, ...(evidence.participantActors ?? [])].filter(
    isVerifiedPerson,
  );
  if (creator && isReader(creator, reader)) return "mine";
  if (participants.some((actor) => isReader(actor, reader))) return "mine";
  return creator || participants.length > 0 ? "others" : "unknown";
}

/**
 * Whether a session with `ownership` may notify `reader`.
 *
 * The Host owner's own devices (no Hub identity) own everything on their Host.
 * Unknown ownership notifies For me only for a reader with daemon-wide access, and a request
 * or failure from it only the Host owner: nobody is paged with someone else's request.
 */
export function notificationAllowed(
  reader: NotificationReader,
  ownership: NotificationOwnership,
  kind: NotificationEventKind = "update",
): boolean {
  if (reader.scope === "off") return false;
  if (reader.scope === "all") return true;
  // Unattributed work is provisionally a daemon-wide reader's, as in the session list, but a
  // request or failure from it, which can quote tool input, goes only to the Host owner, or to
  // a reader who asked for All; never to For me, Needs me or Others.
  if (kind === "needs" && ownership === "unknown" && reader.actor !== null) return false;
  const unknownIsMine = reader.daemonWide;
  const mine =
    reader.actor === null || ownership === "mine" || (ownership === "unknown" && unknownIsMine);
  if (reader.scope === "needs") return mine && kind === "needs";
  return reader.scope === "mine" ? mine : !mine;
}

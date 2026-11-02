import type { ComposerAttachment } from "@/attachments/types";
import type { ActiveTurnBehavior } from "@clisbot/protocol/messages";

/** Where an unsent message goes: an agent session or a Bot chat on one Host. */
export type OutboxTarget =
  | { kind: "agent"; serverId: string; agentId: string }
  | { kind: "chat"; serverId: string; chatId: string };

/**
 * Why a message is not sent yet. `autoRetry` marks an unknown outcome (the Host was unreachable):
 * the same message id is sent again when that Host reconnects, and the Host deduplicates it.
 */
export interface OutboxFailure {
  reason: "host_unreachable" | "refused";
  message: string;
  autoRetry: boolean;
}

/**
 * One message the user pressed Send on that the Host has not accepted yet. The client message id
 * is chosen once at the press and reused by every retry, so a retry can never send it twice.
 */
export interface OutboxEntry {
  clientMessageId: string;
  target: OutboxTarget;
  text: string;
  attachments: ComposerAttachment[];
  activeTurnBehavior?: ActiveTurnBehavior;
  createdAt: number;
  status: "sending" | "failed";
  failure?: OutboxFailure;
}

export type DeliveryOutcome = { kind: "sent" } | { kind: "failed"; failure: OutboxFailure };

/** No client for the Host, so nothing left the device. */
export class HostUnreachableError extends Error {
  constructor(message = "Host unreachable") {
    super(message);
    this.name = "HostUnreachableError";
  }
}

// The Host already holds this id, with this or an earlier copy of the content (re-encoded images
// can differ in bytes after a restart). Either way the message reached the Host: never resend it
// under a new id.
const ID_ALREADY_HELD = [
  "agent_request_key_conflict",
  "already exists with different text or attachments",
  "conflicts with the accepted files",
  "Queue ID conflicts with submitted content",
];

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isIdAlreadyHeldError(error: unknown): boolean {
  if (errorCode(error) === "already_accepted") return true;
  const message = error instanceof Error ? error.message : String(error);
  return ID_ALREADY_HELD.some((marker) => message.includes(marker));
}

/**
 * The Host refused a Steer because the turn it named ended first. A message pressed while a turn
 * ran can reach the Host after that turn finished; nothing was recorded, so it may be sent again.
 * The daemon throws a plain Error, so its text is the only signal (agent-manager.ts steerAgentRun).
 */
export function isSteerTurnEndedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Active turn changed before steering could be delivered");
}

/** The request may or may not have reached the Host: the connection dropped or timed out. */
export function isUnknownOutcomeError(error: unknown): boolean {
  if (error instanceof HostUnreachableError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "DaemonConnectionError") return true;
  const code = errorCode(error);
  return code === "DAEMON_CONNECTION_LOST" || code === "DAEMON_REQUEST_TIMEOUT";
}

export function classifyDeliveryError(error: unknown, unreachableMessage: string): DeliveryOutcome {
  if (isIdAlreadyHeldError(error)) return { kind: "sent" };
  if (isUnknownOutcomeError(error)) {
    return {
      kind: "failed",
      failure: { reason: "host_unreachable", message: unreachableMessage, autoRetry: true },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "failed", failure: { reason: "refused", message, autoRetry: false } };
}

export function outboxTargetKey(target: OutboxTarget): string {
  return target.kind === "agent"
    ? `agent\u0000${target.serverId}\u0000${target.agentId}`
    : `chat\u0000${target.serverId}\u0000${target.chatId}`;
}

export function isSameOutboxTarget(left: OutboxTarget, right: OutboxTarget): boolean {
  return outboxTargetKey(left) === outboxTargetKey(right);
}

/** Entries for one target, oldest first, so restored rows keep the order they were sent in. */
export function selectTargetEntries(
  entries: Readonly<Record<string, OutboxEntry>>,
  target: OutboxTarget,
): OutboxEntry[] {
  const key = outboxTargetKey(target);
  return Object.values(entries)
    .filter((entry) => outboxTargetKey(entry.target) === key)
    .sort((left, right) => left.createdAt - right.createdAt);
}

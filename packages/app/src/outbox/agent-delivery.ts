import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { encodeImageMessagesForSend } from "@/attachments/service";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { uploadLocalQueueCopies } from "@/composer/host-queue-content";
import { splitIntoMessageParts } from "@/composer/message-parts";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import type { QueueMessageParts } from "@/composer/types";
import { i18n } from "@/i18n/i18next";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { createUserMessage, generateMessageId, type UserMessageItem } from "@/types/stream";
import { releaseOutboxAttachments, retainOutboxAttachments } from "./attachment-retention";
import {
  classifyDeliveryError,
  HostUnreachableError,
  isIdAlreadyHeldError,
  isSteerTargetRefusal,
  type DeliveryOutcome,
  type OutboxEntry,
} from "./model";
import { inDeliveryLane } from "./lane";
import { getOutboxEntry, useOutboxStore } from "./store";

type AgentEntry = OutboxEntry & { target: { kind: "agent" } };

export interface AgentSendRequest {
  serverId: string;
  agentId: string;
  text: string;
  attachments: OutboxEntry["attachments"];
  activeTurnBehavior?: OutboxEntry["activeTurnBehavior"];
  /** First attempt only: the composer's queue handoff for a draft split into several parts. */
  queueParts?: QueueMessageParts;
}

type AttemptOutcome = DeliveryOutcome | { kind: "queued" };

const inFlight = new Set<string>();

function session(serverId: string) {
  return useSessionStore.getState().sessions[serverId];
}

/** Exact-turn steering needs the Host queue; older Hosts steer whatever turn runs. */
function steerTurnId(entry: AgentEntry): string | undefined {
  if (entry.activeTurnBehavior !== "steer") return undefined;
  const current = session(entry.target.serverId);
  if (current?.serverInfo?.features?.hostInputQueue !== true) return undefined;
  return selectAgentTurnPresentation(current, entry.target.agentId).turnId ?? undefined;
}

/** How long a Steer waits to learn the turn it targets before the Host decides alone. */
const STEER_TURN_WAIT_MS = 3_000;

/** The Host's own turn, not the one this app's pending message implies. */
function openTurnId(entry: AgentEntry): { open: boolean; turnId: string | undefined } {
  const current = session(entry.target.serverId);
  const { agentId } = entry.target;
  const liveness =
    current?.agents.get(agentId)?.turn ?? current?.agentDetails.get(agentId)?.turn ?? null;
  if (liveness?.phase !== "open") return { open: false, turnId: undefined };
  return { open: true, turnId: liveness.turnId ?? undefined };
}

/**
 * The turn a Steer should name. A message pressed right after another can reach this point
 * before the turn that message started has an id here, and a Host with the queue refuses a Steer
 * that names no turn while one runs. So it waits for the id, or for the agent to go idle, in which
 * case it names none and the Host starts a turn. `stale` is a turn the Host already said ended.
 */
async function steerTurnIdWhenKnown(
  entry: AgentEntry,
  stale?: string,
): Promise<string | undefined> {
  if (entry.activeTurnBehavior !== "steer") return undefined;
  if (session(entry.target.serverId)?.serverInfo?.features?.hostInputQueue !== true)
    return undefined;
  const read = () => {
    const turn = openTurnId(entry);
    if (!turn.open) return { done: true, turnId: undefined };
    if (turn.turnId && turn.turnId !== stale) return { done: true, turnId: turn.turnId };
    return { done: false, turnId: undefined };
  };
  const now = read();
  if (now.done) return now.turnId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  try {
    return await new Promise<string | undefined>((resolve) => {
      timer = setTimeout(resolve, STEER_TURN_WAIT_MS, undefined);
      unsubscribe = useSessionStore.subscribe(() => {
        const next = read();
        if (next.done) resolve(next.turnId);
      });
    });
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

export function outboxAgentRow(entry: AgentEntry, turnId?: string): UserMessageItem {
  const wire = splitComposerAttachmentsForSubmit(entry.attachments);
  return createUserMessage({
    clientMessageId: entry.clientMessageId,
    text: entry.text,
    timestamp: new Date(entry.createdAt),
    images: wire.images,
    attachments: wire.attachments,
    ...(turnId ? { turnId } : {}),
  });
}

/**
 * Shows the message in the press frame and starts delivery. The returned promise settles when
 * the Host answered or the attempt failed; the row carries the outcome either way.
 */
export function startAgentSend(request: AgentSendRequest): {
  clientMessageId: string;
  delivery: Promise<DeliveryOutcome>;
} {
  const entry: AgentEntry = {
    clientMessageId: generateMessageId(),
    target: { kind: "agent", serverId: request.serverId, agentId: request.agentId },
    text: request.text,
    attachments: request.attachments,
    ...(request.activeTurnBehavior ? { activeTurnBehavior: request.activeTurnBehavior } : {}),
    createdAt: Date.now(),
    status: "sending",
  };
  retainOutboxAttachments(entry);
  useOutboxStore.getState().add(entry);
  createMessageSubmissionWriter(request.serverId).begin(
    request.agentId,
    outboxAgentRow(entry, steerTurnId(entry)),
  );
  return {
    clientMessageId: entry.clientMessageId,
    delivery: deliverAgentEntry(entry, request.queueParts),
  };
}

async function deliverAgentEntry(
  entry: AgentEntry,
  queueParts?: QueueMessageParts,
): Promise<DeliveryOutcome> {
  const id = entry.clientMessageId;
  if (inFlight.has(id)) return { kind: "sent" };
  inFlight.add(id);
  try {
    const outcome = await inDeliveryLane(entry.target, () =>
      attemptAgentDelivery(entry, queueParts),
    );
    return settleAgentEntry(entry, outcome);
  } finally {
    inFlight.delete(id);
  }
}

async function attemptAgentDelivery(
  entry: AgentEntry,
  queueParts?: QueueMessageParts,
): Promise<AttemptOutcome> {
  try {
    const client = session(entry.target.serverId)?.client ?? null;
    if (!client) throw new HostUnreachableError();
    const parts = await prepareAgentParts(client, entry);
    // A Host with a queue refuses a Steer without the turn the first part just started, so
    // parts go through the queue, which delivers them in order; the queue rows replace this one.
    if (parts.length > 1 && queueParts) {
      await queueParts(parts);
      return { kind: "queued" };
    }
    await sendAgentParts(client, entry, parts);
    return { kind: "sent" };
  } catch (error) {
    return classifyDeliveryError(error, i18n.t("messageDelivery.hostUnreachable"));
  }
}

async function prepareAgentParts(client: DaemonClient, entry: AgentEntry) {
  const features = session(entry.target.serverId)?.serverInfo?.features;
  const retained = await uploadLocalQueueCopies(client, entry.attachments);
  const wire = splitComposerAttachmentsForSubmit(retained, {
    format: resolveComposerAttachmentSubmitFormat({
      supportsForgeAttachments: features?.forgeSearch === true,
    }),
  });
  return splitIntoMessageParts({
    text: entry.text,
    attachments: wire.attachments,
    imageMessages: await encodeImageMessagesForSend(wire.images),
  });
}

async function sendAgentParts(
  client: DaemonClient,
  entry: AgentEntry,
  parts: Awaited<ReturnType<typeof prepareAgentParts>>,
): Promise<void> {
  const last = parts.length - 1;
  for (const [index, part] of parts.entries()) {
    // Derived ids keep the earlier parts of a retried message deduplicated by the Host. The
    // row shows the text, so its own id goes to the part that carries the text.
    const send = (turnId: string | undefined) =>
      client.sendAgentMessage(entry.target.agentId, part.text, {
        messageId:
          index === last ? entry.clientMessageId : `${entry.clientMessageId}-part-${index + 1}`,
        ...(entry.activeTurnBehavior ? { activeTurnBehavior: entry.activeTurnBehavior } : {}),
        ...(turnId ? { expectedTurnId: turnId } : {}),
        images: part.images,
        attachments: part.attachments,
      });
    const expectedTurnId = await steerTurnIdWhenKnown(entry);
    try {
      await send(expectedTurnId);
    } catch (error) {
      // The Host refused the Steer before the agent saw it: the turn it named ended, or a turn ran
      // that it could not name. Once the agent is idle, send it naming no turn, so the Host starts
      // one. Never steer a different turn instead: a refused Steer stays this message's to keep,
      // and a queue owner puts it back (queue-compatibility "a rejected steer must remain local").
      if (!isSteerTargetRefusal(error)) throw error;
      await steerTurnIdWhenKnown(entry, expectedTurnId);
      if (openTurnId(entry).open) throw error;
      await send(undefined).catch((retryError: unknown) => {
        // A Host from before 2.2.2 keeps the refused attempt's receipt, so it answers the same id
        // with a key conflict: the message was not delivered, never count that as sent.
        throw isIdAlreadyHeldError(retryError) ? error : retryError;
      });
    }
  }
}

function finishAgentEntry(entry: AgentEntry): void {
  useOutboxStore.getState().remove(entry.clientMessageId);
  releaseOutboxAttachments(entry.clientMessageId);
}

function settleAgentEntry(entry: AgentEntry, outcome: AttemptOutcome): DeliveryOutcome {
  const { serverId, agentId } = entry.target;
  const writer = createMessageSubmissionWriter(serverId);
  const id = entry.clientMessageId;
  // Deleted by the user, or its canonical row already arrived: the row has nothing left to show.
  // A refusal is still reported, so an owner that waits (a queue, review feedback) keeps its copy.
  if (!getOutboxEntry(id)) {
    if (outcome.kind === "failed") return outcome;
    writer.accept(agentId, id);
    return { kind: "sent" };
  }
  if (outcome.kind === "queued") {
    writer.reject(agentId, id);
    finishAgentEntry(entry);
    return { kind: "sent" };
  }
  if (outcome.kind === "sent") {
    writer.accept(agentId, id);
    finishAgentEntry(entry);
    return outcome;
  }
  writer.fail(agentId, id, outcome.failure);
  useOutboxStore.getState().markFailed(id, outcome.failure);
  return outcome;
}

/** Sends a failed or interrupted message again under its original id. */
export function retryAgentSend(clientMessageId: string): Promise<DeliveryOutcome> | null {
  const entry = getOutboxEntry(clientMessageId);
  if (entry?.target.kind !== "agent" || inFlight.has(clientMessageId)) return null;
  const agentEntry = entry as AgentEntry;
  useOutboxStore.getState().markSending(clientMessageId);
  createMessageSubmissionWriter(agentEntry.target.serverId).retry(
    agentEntry.target.agentId,
    clientMessageId,
  );
  return deliverAgentEntry({ ...agentEntry, status: "sending" });
}

export function discardAgentSend(clientMessageId: string): void {
  const entry = getOutboxEntry(clientMessageId);
  if (entry?.target.kind !== "agent") return;
  const agentEntry = entry as AgentEntry;
  createMessageSubmissionWriter(agentEntry.target.serverId).discard(
    agentEntry.target.agentId,
    clientMessageId,
  );
  finishAgentEntry(agentEntry);
}

/**
 * After a restart the session stream starts without the unsent rows. Puts each one back in send
 * order and reports which ones to send again: those interrupted mid-send and those waiting for
 * the Host.
 */
export function restoreAgentOutbox(serverId: string): string[] {
  if (!session(serverId)) return [];
  const due: string[] = [];
  const entries = Object.values(useOutboxStore.getState().entries)
    .filter((entry): entry is AgentEntry => entry.target.kind === "agent")
    .filter((entry) => entry.target.serverId === serverId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const writer = createMessageSubmissionWriter(serverId);
  for (const entry of entries) {
    if (inFlight.has(entry.clientMessageId)) continue;
    writer.restore(entry.target.agentId, outboxAgentRow(entry), entry.failure);
    if (entry.status === "sending" || entry.failure?.autoRetry) due.push(entry.clientMessageId);
  }
  return due;
}

export function isAgentSendInFlight(clientMessageId: string): boolean {
  return inFlight.has(clientMessageId);
}

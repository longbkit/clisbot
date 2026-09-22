// Held messages and the flush that sends them
// (docs/features/channels/conversation-flow.md): `batching` holds a trigger
// until the burst it opens is over, and `whenBusy: queue` holds a message
// until its binding's running turn ends. A held message is a completed ingress
// row filed `held` in its binding's inbox, so its lane moves on — a `/stop`
// behind it is not stuck — and a Hub restart finds it again.
//
// The send goes back through the lane: when a binding's held messages are due,
// a flush row is admitted to the lane of the newest one, and the drain hands
// it to the plane like any message. Every message that arrived before the
// flush row is decided before it, and everything after it waits for it, so a
// binding's messages still reach its session in arrival order. No drain worker
// ever waits out a pause; this scheduler's timers only admit the flush row.
import type { ChannelInboxScope } from "../../db/channel-inbox.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import type { ConversationSettings } from "../config/conversation.js";
import type { InboundQueueSink } from "@getpaseo/channels-shared";
import type { ChannelIngressDeferral } from "../ingress/drain.js";
import type { PlaneInboundDeferral, PlaneLogger } from "../plane/types.js";
import type { BindingInbox } from "./inbox.js";
import { parseInboxBindingKey } from "./inbox.js";

export const HELD_FLUSH_KIND = "channel.held-flush";

/** The stored payload of a flush row. */
export interface HeldFlushPayload {
  kind: typeof HELD_FLUSH_KIND;
  channel: string;
  accountId: string;
  bindingKey: string;
}

export function isHeldFlushPayload(payload: unknown): payload is HeldFlushPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "kind" in payload &&
    payload.kind === HELD_FLUSH_KIND &&
    "channel" in payload &&
    typeof payload.channel === "string" &&
    "accountId" in payload &&
    typeof payload.accountId === "string" &&
    "bindingKey" in payload &&
    typeof payload.bindingKey === "string"
  );
}

/**
 * The longest a message waits for a running turn under `whenBusy: queue`. A
 * turn's end is a stream event, and a lost event must not hold a message for
 * good; past this the message steers into whatever is running.
 */
export const BUSY_HOLD_MAX_MS = 15 * 60_000;

/** A wake that could not read or admit tries again after this long. */
const WAKE_RETRY_MS = 5_000;

/**
 * When a binding's held messages are due, from their arrival times (oldest
 * first): at the end of the running turn under `whenBusy: queue` (bounded), else
 * once no message has arrived for `pauseSeconds`, the first has waited
 * `maxWaitSeconds`, or `maxMessages` are held — whichever comes first. With
 * batching off, held messages are due as soon as nothing holds them.
 */
export function heldDueAt(
  arrivals: readonly number[],
  settings: ConversationSettings,
  turnRunning: boolean,
): number | undefined {
  const first = arrivals[0];
  const last = arrivals.at(-1);
  if (first === undefined || last === undefined) return undefined;
  if (settings.whenBusy === "queue" && turnRunning) return first + BUSY_HOLD_MAX_MS;
  const window = settings.batching;
  if (window === undefined || arrivals.length >= window.maxMessages) return first;
  return Math.min(last + window.pauseSeconds * 1_000, first + window.maxWaitSeconds * 1_000);
}

/** What the flush row is admitted as. */
export interface HeldFlushAdmission {
  externalEventId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  laneKey: string;
  payload: HeldFlushPayload;
}

/** One binding the scheduler watches, with what decides its due time. */
export interface HeldBinding {
  scope: ChannelInboxScope;
  settings: ConversationSettings;
  /** The session the binding is bound to, when it is. */
  agentId?: string | undefined;
}

export interface HeldFlushSchedulerDeps {
  inbox: BindingInbox;
  now: () => number;
  isTurnRunning: (agentId: string) => boolean;
  /** Admit the flush row to the ingress queue (idempotent by event id). */
  admit: (flush: HeldFlushAdmission) => Promise<void>;
  logger: PlaneLogger;
  /** Timer seam; returns the cancel. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** The flush row for a binding's held rows: one per newest held message, so
 * a repeated wake admits it once and a later message gets its own. */
export function heldFlushAdmission(
  scope: ChannelInboxScope,
  held: readonly ChannelIngressQueueRecord[],
): HeldFlushAdmission | undefined {
  const newest = held.at(-1);
  const key = parseInboxBindingKey(scope.bindingKey);
  if (newest === undefined || key === undefined) return undefined;
  return {
    externalEventId: `held-flush:${scope.bindingKey}:${newest.id}`,
    externalConversationId: key.externalConversationId,
    externalThreadId: key.externalThreadId,
    laneKey: newest.laneKey,
    payload: {
      kind: HELD_FLUSH_KIND,
      channel: scope.channel,
      accountId: scope.accountId,
      bindingKey: scope.bindingKey,
    },
  };
}

/**
 * Wakes each binding that holds messages when they fall due and admits its
 * flush row. The timers are only a wake-up: the held rows are durable, and
 * `recover` admits a flush for every binding still holding after a restart.
 */
export class HeldFlushScheduler {
  private readonly watched = new Map<
    string,
    { binding: HeldBinding; cancel?: (() => void) | undefined }
  >();
  private stopped = false;

  constructor(private readonly deps: HeldFlushSchedulerDeps) {}

  /** Watch a binding that just held a message; wake it when it is due. */
  async watch(binding: HeldBinding): Promise<void> {
    const watched = this.watched.get(binding.scope.bindingKey);
    watched?.cancel?.();
    this.watched.set(binding.scope.bindingKey, { binding });
    await this.wakeSafely(binding.scope.bindingKey);
  }

  /** A turn ended: the bindings waiting on it may be due now. */
  async turnEnded(agentId: string): Promise<void> {
    const due = [...this.watched.values()].filter(({ binding }) => binding.agentId === agentId);
    for (const { binding } of due) await this.wakeSafely(binding.scope.bindingKey);
  }

  /** After a restart the timing is gone and the rows are not: flush every
   * binding still holding. Sending a batch early beats holding it forever. */
  async recover(account: { organizationId: string; channel: string; accountId: string }) {
    for (const bindingKey of await this.deps.inbox.heldBindings(account)) {
      await this.flushNow({ ...account, bindingKey });
    }
  }

  /** Admit a flush for whatever the binding still holds (a batch sent only
   * part of it: rows filed after its first attempt). */
  async flushNow(scope: ChannelInboxScope): Promise<void> {
    await this.admitFlush(scope, await this.deps.inbox.heldRows(scope));
  }

  stop(): void {
    this.stopped = true;
    for (const { cancel } of this.watched.values()) cancel?.();
    this.watched.clear();
  }

  private async wake(bindingKey: string): Promise<void> {
    const watched = this.watched.get(bindingKey);
    if (watched === undefined || this.stopped) return;
    watched.cancel?.();
    watched.cancel = undefined;
    const { binding } = watched;
    const held = await this.deps.inbox.heldRows(binding.scope);
    const running = binding.agentId !== undefined && this.deps.isTurnRunning(binding.agentId);
    const dueAt = heldDueAt(
      held.map((row) => row.createdAt.getTime()),
      binding.settings,
      running,
    );
    if (dueAt === undefined) {
      this.watched.delete(bindingKey);
      return;
    }
    const wait = dueAt - this.deps.now();
    if (wait > 0) {
      this.rearm(bindingKey, wait);
      return;
    }
    await this.admitFlush(binding.scope, held);
    this.watched.delete(bindingKey);
  }

  /** A wake never throws into its caller: a fault is logged and retried. */
  private async wakeSafely(bindingKey: string): Promise<void> {
    try {
      await this.wake(bindingKey);
    } catch (error) {
      this.deps.logger.warn("held channel messages could not be flushed yet; retrying", {
        bindingKey,
        error: error instanceof Error ? error.message : String(error),
      });
      this.rearm(bindingKey, WAKE_RETRY_MS);
    }
  }

  private rearm(bindingKey: string, delayMs: number): void {
    const watched = this.watched.get(bindingKey);
    if (watched === undefined || this.stopped) return;
    watched.cancel?.();
    watched.cancel = (this.deps.schedule ?? defaultSchedule)(
      () => void this.wakeSafely(bindingKey),
      delayMs,
    );
  }

  private async admitFlush(
    scope: ChannelInboxScope,
    held: readonly ChannelIngressQueueRecord[],
  ): Promise<void> {
    const flush = heldFlushAdmission(scope, held);
    if (flush !== undefined) await this.deps.admit(flush);
  }
}

/**
 * A binding's flush row goes through the account's durable queue like any
 * inbound, so it is ordered in its lane and survives a restart. No queue =
 * nothing is ever held.
 */
export function heldFlushAdmitter(
  queue: InboundQueueSink | undefined,
  account: { channel: string; accountId: string },
): ((flush: HeldFlushAdmission) => Promise<void>) | undefined {
  if (queue === undefined) return undefined;
  return async (flush) => {
    await queue.enqueue({
      channel: account.channel,
      accountId: account.accountId,
      externalEventId: flush.externalEventId,
      externalMessageId: flush.externalEventId,
      externalConversationId: flush.externalConversationId,
      externalThreadId: flush.externalThreadId,
      laneKey: flush.laneKey,
      payload: flush.payload,
    });
  };
}

/**
 * The drain's dispatch for a flush row; undefined when the row is not one. No
 * plane yet is a failure, so the drain brings the row back instead of dropping
 * it; a deferral from the plane hands it back as back-pressure.
 */
export function dispatchIfHeldFlush(
  plane:
    | {
        deliverHeld(
          payload: HeldFlushPayload,
          id: string,
        ): Promise<PlaneInboundDeferral | undefined>;
      }
    | undefined,
  payload: unknown,
  flushId: string,
): Promise<ChannelIngressDeferral | undefined> | undefined {
  if (!isHeldFlushPayload(payload)) return undefined;
  if (plane === undefined) return Promise.reject(new Error("channel plane is not running"));
  return plane
    .deliverHeld(payload, flushId)
    .then((deferral) =>
      deferral === undefined ? undefined : { kind: "deferred" as const, ...deferral },
    );
}

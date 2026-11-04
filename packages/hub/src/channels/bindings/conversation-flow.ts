// The plane's side of the conversation flow
// (docs/features/channels/conversation-flow.md): the binding inbox, the held
// messages and their flush, dead letters, and the one runtime fact holding
// needs — whether a binding's turn is running. The plane hands it the few
// seams it needs (`ConversationPlaneSeams`) and asks: keep this refused message
// as context? hold this admitted one? what does this flush row deliver? what
// happens to a message the queue gave up on?
import type { ChannelStore } from "../../db/channels.js";
import type { ChannelInboxScope } from "../../db/channel-inbox.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { conversationSettings, type ConversationSettings } from "../config/conversation.js";
import type { InboundReplyParams } from "../loader/host.js";
import { claimedInbound } from "../ingress/claimed-inbound.js";
import { INGRESS_OUTCOME_UNKNOWN } from "../ingress/attempt.js";
import { readInboundKind } from "../plane/inbound-kinds.js";
import type {
  InboundMessage,
  InboundOutcome,
  PlaneInboundDeferral,
  PlaneInboundResult,
  PlaneLogger,
  SupportedChannelName,
} from "../plane/types.js";
import {
  HeldFlushScheduler,
  isHeldFlushPayload,
  type HeldFlushAdmission,
  type HeldFlushPayload,
} from "./held-flush.js";
import { BindingInbox, type Delivery } from "./inbox.js";
import type { BindingEngine } from "./index.js";
import { deriveBindingKey, recordedRoute } from "./stored-route.js";

/** How soon a flush the account could not serve comes back. */
const HELD_FLUSH_RETRY_MS = 60_000;

/** While the plane counts a turn as running, how often the Host is asked. */
export const TURN_RECONCILE_MS = 60_000;

/** What the plane lends the conversation flow. */
export interface ConversationPlaneSeams {
  engine(): BindingEngine;
  /** The account serving the message now; undefined = not now (kill switch). */
  accountFor(message: InboundMessage): CompiledChannelAccount | undefined;
  /** The Route serving the message now: its binding's owner, else a new selection. */
  resolveRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<{ kind: "selected"; route: CompiledRoute } | { kind: "unmatched" }>;
  notice(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    kind: "unprocessed" | "refused" | "host-lost" | "outcome-unknown" | "reply-unconfirmed",
  ): Promise<void>;
  mayUse(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<boolean>;
  /** Send a delivery the way an admitted message is sent. */
  dispatch(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<PlaneInboundResult>;
}

export interface ConversationFlowDeps {
  store: ChannelStore;
  organizationId: string;
  accountScope: { channel: SupportedChannelName; accountId: string };
  normalizeInbound: (params: InboundReplyParams) => InboundMessage | null;
  /** Admit a flush row to the account's ingress queue. Absent = nothing is
   * ever held: without a flush, a held message would never be sent. */
  admitHeldFlush?: ((flush: HeldFlushAdmission) => Promise<void>) | undefined;
  logger: PlaneLogger;
  plane: ConversationPlaneSeams;
  /**
   * The agents the Host reports as running. A turn whose terminal event never
   * reached the plane (its stream was cut) is ended when the Host says its
   * agent is idle. Absent = turns end only on their terminal event.
   */
  readRunningAgentIds?: (() => Promise<ReadonlySet<string>>) | undefined;
  reconcileEveryMs?: number | undefined;
}

/** A flush row's held messages, as the one delivery that sends them. */
export interface HeldBatch {
  scope: ChannelInboxScope;
  delivery: Delivery;
  /** The held rows, oldest first (`sentIn` says whether a prompt carried them). */
  rows: readonly ChannelIngressQueueRecord[];
}

/** A dead-lettered row: what the plane reads off it. */
export type DeadLetteredRow = Pick<
  ChannelIngressQueueRecord,
  "id" | "payload" | "sentIn" | "failedReason"
>;

/** Where a running turn answers: the message it answers, and its Route. */
interface TurnAddress {
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  /** The sequence its send began at. */
  sentAt: number;
  /** The Host's socket dropped and came back while it ran: stream events in
   * the gap never reached the plane. */
  gapped?: boolean;
}

interface DeadLetter {
  message: InboundMessage;
  account: CompiledChannelAccount;
  rows: readonly Pick<ChannelIngressQueueRecord, "id" | "sentIn">[];
  scope?: ChannelInboxScope | undefined;
}

export class ConversationFlow {
  readonly inbox: BindingInbox;
  private readonly scheduler: HeldFlushScheduler;
  /** Agents whose turn the plane started and has not yet seen end, with where
   * that turn answers. In memory: after a restart no turn is known to run, a
   * queued message steers, and nobody is told about a Host that went away
   * while this process was down. */
  private readonly runningTurns = new Map<string, TurnAddress>();
  /** Orders sends against turn ends: a turn can end (a fast finish, a failed
   * start) before the send that started it returns. */
  private sequence = 0;
  private readonly turnEndedAt = new Map<string, number>();
  /** Sends not yet returned: the agent they reach is not known until then. */
  private sendsInFlight = 0;
  /** Per agent, the sequence at which its latest send returned. */
  private readonly sendReturnedAt = new Map<string, number>();
  /** The sequence at which the latest send that named no agent returned. */
  private unnamedSendReturnedAt = 0;
  /** Per agent, the sequence of its latest stream event, from any source: a
   * turn the app or another account started never passes through `deliver`. */
  private readonly streamSeenAt = new Map<string, number>();
  private reconciling = false;
  private stopped = false;
  private readonly reconcileTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: ConversationFlowDeps) {
    this.inbox = new BindingInbox({
      store: deps.store.inbox,
      organizationId: deps.organizationId,
      readMessage: (record) => deps.normalizeInbound(claimedInbound(record.payload, record.id)),
    });
    this.scheduler = new HeldFlushScheduler({
      inbox: this.inbox,
      // Held rows are timed by their database arrival, so the wall clock.
      now: () => Date.now(),
      isTurnRunning: (agentId) => this.runningTurns.has(agentId),
      admit: (flush) => deps.admitHeldFlush?.(flush) ?? Promise.resolve(),
      logger: deps.logger,
    });
    if (deps.readRunningAgentIds !== undefined) {
      this.reconcileTimer = setInterval(
        () => void this.reconcileTurns(),
        deps.reconcileEveryMs ?? TURN_RECONCILE_MS,
      );
      this.reconcileTimer.unref?.();
    }
  }

  /**
   * Send a delivery through the binding engine and note the turn it started.
   * A turn end seen after the send began already closed that turn, so a late
   * return does not mark it running. The stream names no turn a steer
   * started, so a steer that overlaps a turn end is taken as ended too.
   */
  async deliver(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe: (agentId: string) => Promise<void>,
  ): Promise<InboundOutcome> {
    this.sequence += 1;
    const sentAt = this.sequence;
    this.sendsInFlight += 1;
    let agentId: string | undefined;
    try {
      const outcome = await this.deps.plane.engine().deliver(delivery, account, route, subscribe);
      const started = outcome.kind === "bound" || outcome.kind === "steered";
      if (started) agentId = outcome.agentId;
      if (started && (this.turnEndedAt.get(outcome.agentId) ?? 0) < sentAt) {
        this.runningTurns.set(outcome.agentId, {
          message: delivery.message,
          account,
          route,
          sentAt,
        });
      }
      return outcome;
    } finally {
      this.sendsInFlight -= 1;
      this.sequence += 1;
      if (agentId === undefined) this.unnamedSendReturnedAt = this.sequence;
      else this.sendReturnedAt.set(agentId, this.sequence);
    }
  }

  /**
   * End the turns the Host says are no longer running. Their terminal event
   * never reached the plane (a cut stream), and left "running" they hold
   * queued messages forever and turn the next Host disconnect into a notice
   * that the machine went away mid-turn. One status read per interval, and
   * only while a turn is counted.
   *
   * The read can be older than a new turn on the same agent, so a turn is
   * ended only when nothing could have started one since the read began: no
   * send in flight, none returned for that agent (or for an unknown agent)
   * after it, no stream event for that agent after it (a turn started from the
   * app or another account), and the recorded turn itself is older. Anything
   * else waits for the next read, or for the terminal event. The checks and
   * the end run with no await between them. A read that failed proves nothing
   * and ends nothing.
   */
  async reconcileTurns(): Promise<void> {
    const read = this.deps.readRunningAgentIds;
    if (read === undefined || this.stopped || this.reconciling || this.runningTurns.size === 0) {
      return;
    }
    this.reconciling = true;
    try {
      const readFrom = this.sequence;
      let running: ReadonlySet<string>;
      try {
        running = await read();
      } catch {
        return;
      }
      // A snapshot: ending a turn awaits, and the map can change meanwhile.
      for (const [agentId, at] of Array.from(this.runningTurns)) {
        if (this.stopped) return;
        if (running.has(agentId)) continue;
        // Re-checked per agent: ending one awaits, and a send may start meanwhile.
        if (!this.quietSince(readFrom, agentId, at)) continue;
        this.deps.logger.warn("channel turn ended without its terminal event", { agentId });
        // Ended first (its synchronous part), so nothing can re-check it meanwhile.
        const ended = this.turnEnded(agentId);
        await this.unconfirmed(at);
        await ended;
      }
      this.forgetMarksBefore(readFrom);
    } finally {
      this.reconciling = false;
    }
  }

  /** Nothing since `readFrom` could have started a newer turn on this agent. */
  private quietSince(readFrom: number, agentId: string, at: TurnAddress): boolean {
    return (
      this.runningTurns.get(agentId) === at &&
      at.sentAt <= readFrom &&
      this.sendsInFlight === 0 &&
      this.unnamedSendReturnedAt <= readFrom &&
      (this.sendReturnedAt.get(agentId) ?? 0) <= readFrom &&
      (this.streamSeenAt.get(agentId) ?? 0) <= readFrom
    );
  }

  /** Marks older than a completed read matter only for turns still counted. */
  private forgetMarksBefore(readFrom: number): void {
    for (const marks of [this.sendReturnedAt, this.streamSeenAt]) {
      for (const [agentId, at] of marks) {
        if (at <= readFrom && !this.runningTurns.has(agentId)) marks.delete(agentId);
      }
    }
  }

  /**
   * A stream event arrived for this agent. Called synchronously on receipt:
   * the Host writes stream frames and the status answer on one ordered
   * socket, so an event noted after a read began may belong to a turn that
   * answer does not know about.
   */
  noteStream(agentId: string): void {
    this.sequence += 1;
    this.streamSeenAt.set(agentId, this.sequence);
  }

  /**
   * The Host's socket came back inside the disconnect grace: the turns still
   * running lost whatever their stream carried in the gap. Each is told once,
   * when it ends, that its reply may be incomplete.
   */
  hostReconnected(): void {
    for (const at of this.runningTurns.values()) at.gapped = true;
  }

  /** The turn's terminal event arrived. */
  async turnCompleted(agentId: string): Promise<void> {
    const at = this.runningTurns.get(agentId);
    const ended = this.turnEnded(agentId);
    if (at?.gapped === true) await this.unconfirmed(at);
    await ended;
  }

  /** Say once that this turn's reply may be incomplete; nothing is resent. */
  private async unconfirmed(at: TurnAddress): Promise<void> {
    await this.deps.plane
      .notice(at.message, at.account, at.route, "reply-unconfirmed")
      .catch((error: unknown) => {
        this.deps.logger.warn("channel unconfirmed-reply notice failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** The turn ended (or its agent was let go): release what waited on it. */
  async turnEnded(agentId: string): Promise<void> {
    this.sequence += 1;
    this.turnEndedAt.set(agentId, this.sequence);
    if (!this.runningTurns.delete(agentId)) return;
    await this.scheduler.turnEnded(agentId);
  }

  /**
   * The Host is gone (socket drop, daemon stop, lost lease). Every turn that
   * was running dies with it and its terminal event never comes, so each
   * conversation that had one is told, once. The prompt is never sent again:
   * the Agent may have acted on it, and an unknown outcome is not resent.
   */
  async hostLost(): Promise<void> {
    const interrupted = [...this.runningTurns];
    this.runningTurns.clear();
    for (const [agentId, at] of interrupted) {
      this.sequence += 1;
      this.turnEndedAt.set(agentId, this.sequence);
      await this.deps.plane
        .notice(at.message, at.account, at.route, "host-lost")
        .catch((error: unknown) => {
          this.deps.logger.warn("channel interrupted-turn notice failed", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      // Whatever waited for this turn is free: it will never end on its own.
      await this.scheduler.turnEnded(agentId);
    }
  }

  /** A message that was not for the bot waits as its binding's context. */
  async keepAsContext(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<void> {
    if (route.target.kind !== "agent") return;
    await this.inbox.keepUnmentioned(message, route, () =>
      this.deps.plane.mayUse(message, account, route),
    );
  }

  /** `/new` and `/fork` start a new conversation: the context kept so far
   * belongs to the old one. */
  async beforeCommand(command: string, message: InboundMessage, route: CompiledRoute) {
    if (command === "new" || command === "fork") await this.inbox.closeContext(message, route);
  }

  /**
   * Hold an admitted message when its Route batches, or when `whenBusy: queue`
   * and its binding's turn is running or already holds messages (a later one
   * never overtakes them). Returns why it was held; undefined = send it now.
   */
  async hold(message: InboundMessage, route: CompiledRoute): Promise<string | undefined> {
    if (this.deps.admitHeldFlush === undefined || message.ingressId === undefined) return undefined;
    const settings = conversationSettings(route.defaults);
    // The common Route neither batches nor queues: no read on its hot path.
    if (settings.batching === undefined && settings.whenBusy !== "queue") return undefined;
    const agentId = await this.boundAgent(message, route);
    const reason = await this.holdReason(message, settings, agentId, route);
    if (reason === undefined) return undefined;
    const scope = await this.inbox.hold(message, route);
    await this.scheduler.watch({ scope, settings, agentId });
    return reason;
  }

  /**
   * A flush row came due: send the binding's held messages as one prompt. A
   * flush that cannot send never strands them: an account that is not serving
   * hands the row back, and anything else that did not reach a session moves
   * the rows to context (or to delivered, when a prompt already carried them).
   */
  async deliverHeld(
    payload: HeldFlushPayload,
    flushId: string,
  ): Promise<PlaneInboundDeferral | undefined> {
    const batch = await this.heldBatch(payload, flushId);
    if (batch === undefined) return undefined;
    const account = this.deps.plane.accountFor(batch.delivery.message);
    if (account === undefined) {
      return { reason: "the account is not serving", retryAfterMs: HELD_FLUSH_RETRY_MS };
    }
    const route = await this.servingRoute(batch.delivery.message, account);
    const sent = route && (await this.deps.plane.dispatch(batch.delivery, account, route));
    if (sent?.deferred !== undefined) return sent.deferred;
    const kind = sent?.outcome?.kind;
    if (kind === "bound" || kind === "steered") {
      await this.scheduler.flushNow(batch.scope);
    } else {
      await this.inbox.fileUndelivered(batch.scope, batch.rows);
    }
    return undefined;
  }

  /**
   * The queue gave up on a row. A message no prompt ever carried stays as
   * context under the binding that serves it; any other may already be with
   * the Agent, and an unknown outcome is never sent twice. The sender hears
   * which, once.
   */
  async onDeadLettered(record: DeadLetteredRow): Promise<void> {
    const letter = await this.deadLetterOf(record);
    if (letter === undefined) return;
    const { message, account, rows } = letter;
    const route = await this.servingRoute(message, account);
    const scope = letter.scope ?? (route && this.inbox.scopeOf(message, route));
    const outcomeUnknown = record.failedReason === INGRESS_OUTCOME_UNKNOWN;
    if (scope !== undefined) await this.inbox.fileUndelivered(scope, rows, { outcomeUnknown });
    const kept = scope !== undefined && rows.length > 0 && rows.every((row) => row.sentIn === null);
    // The first Route covering the conversation places the notice.
    const noticeRoute = recordedRoute(account, message.conversation, undefined);
    if (noticeRoute === undefined) return;
    const knownNotice = kept ? "unprocessed" : "refused";
    await this.deps.plane.notice(
      message,
      account,
      noticeRoute,
      outcomeUnknown ? "outcome-unknown" : knownNotice,
    );
  }

  /** Re-admit a flush for every binding a previous run left holding. */
  async recover(): Promise<void> {
    await this.scheduler
      .recover({ organizationId: this.deps.organizationId, ...this.deps.accountScope })
      .catch((error: unknown) => {
        // They stay held for the next start; the account stays up.
        this.deps.logger.warn("held channel messages could not be recovered", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconcileTimer !== undefined) clearInterval(this.reconcileTimer);
    this.scheduler.stop();
    this.runningTurns.clear();
    this.turnEndedAt.clear();
    this.sendReturnedAt.clear();
    this.streamSeenAt.clear();
  }

  /**
   * The delivery a flush row sends: the binding's messages held before it.
   * Its membership is frozen at the first attempt (`sent_in`): a retry sends
   * exactly that set, and rows filed held since wait for the next flush.
   */
  async heldBatch(payload: HeldFlushPayload, flushId: string): Promise<HeldBatch | undefined> {
    const scope = {
      organizationId: this.deps.organizationId,
      channel: payload.channel,
      accountId: payload.accountId,
      bindingKey: payload.bindingKey,
    };
    const held = await this.inbox.heldRows(scope, flushId);
    const frozen = held.find((row) => row.sentIn !== null)?.sentIn;
    const rows = frozen ? held.filter((row) => row.sentIn === frozen) : held;
    const messages = this.inbox.read(rows);
    const message = messages.at(-1);
    if (message === undefined) return undefined;
    return { scope, rows, delivery: { message, held: messages, admitted: true } };
  }

  /** The agent Route that serves the message now, if one does. */
  private async servingRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<CompiledRoute | undefined> {
    const resolved = await this.deps.plane.resolveRoute(message, account);
    return resolved.kind === "selected" && resolved.route.target.kind === "agent"
      ? resolved.route
      : undefined;
  }

  private async deadLetterOf(record: DeadLetteredRow): Promise<DeadLetter | undefined> {
    if (isHeldFlushPayload(record.payload)) {
      const batch = await this.heldBatch(record.payload, record.id);
      const account = batch && this.deps.plane.accountFor(batch.delivery.message);
      if (batch === undefined || account === undefined) return undefined;
      return { message: batch.delivery.message, account, rows: batch.rows, scope: batch.scope };
    }
    const params = claimedInbound(record.payload, record.id);
    const message = this.deps.normalizeInbound(params);
    const kind = readInboundKind(params.ctxPayload).kind;
    const account = message === null ? undefined : this.deps.plane.accountFor(message);
    if (message === null || account === undefined) return undefined;
    if (kind !== "message" && kind !== "command") return undefined;
    // A command's text is never replayed as context.
    return { message, account, rows: kind === "message" ? [record] : [] };
  }

  private async holdReason(
    message: InboundMessage,
    settings: ConversationSettings,
    agentId: string | undefined,
    route: CompiledRoute,
  ): Promise<string | undefined> {
    if (settings.batching !== undefined) return "held for a batch";
    if (settings.whenBusy !== "queue") return undefined;
    if (agentId !== undefined && this.runningTurns.has(agentId)) {
      return "held until the running turn ends";
    }
    const holding = await this.inbox.holds(this.inbox.scopeOf(message, route));
    return holding ? "held behind earlier held messages" : undefined;
  }

  private async boundAgent(
    message: InboundMessage,
    route: CompiledRoute,
  ): Promise<string | undefined> {
    const key = deriveBindingKey(message, route);
    const binding = await this.deps.store.findThreadBinding(
      this.deps.organizationId,
      message.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    return binding?.status === "bound" ? (binding.agentId ?? undefined) : undefined;
  }
}

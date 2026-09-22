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
    kind: "unprocessed" | "refused",
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
}

/** A flush row's held messages, as the one delivery that sends them. */
export interface HeldBatch {
  scope: ChannelInboxScope;
  delivery: Delivery;
  /** The held rows, oldest first (`sentIn` says whether a prompt carried them). */
  rows: readonly ChannelIngressQueueRecord[];
}

/** A dead-lettered row: what the plane reads off it. */
export type DeadLetteredRow = Pick<ChannelIngressQueueRecord, "id" | "payload" | "sentIn">;

interface DeadLetter {
  message: InboundMessage;
  account: CompiledChannelAccount;
  rows: readonly Pick<ChannelIngressQueueRecord, "id" | "sentIn">[];
  scope?: ChannelInboxScope | undefined;
}

export class ConversationFlow {
  readonly inbox: BindingInbox;
  private readonly scheduler: HeldFlushScheduler;
  /** Agents whose turn the plane started and has not yet seen end. In memory:
   * after a restart no turn is known to run, and a queued message steers. */
  private readonly runningTurns = new Set<string>();
  /** Orders sends against turn ends: a turn can end (a fast finish, a failed
   * start) before the send that started it returns. */
  private sequence = 0;
  private readonly turnEndedAt = new Map<string, number>();

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
    const outcome = await this.deps.plane.engine().deliver(delivery, account, route, subscribe);
    const started = outcome.kind === "bound" || outcome.kind === "steered";
    if (started && (this.turnEndedAt.get(outcome.agentId) ?? 0) < sentAt) {
      this.runningTurns.add(outcome.agentId);
    }
    return outcome;
  }

  /** The turn ended (or its agent was let go): release what waited on it. */
  async turnEnded(agentId: string): Promise<void> {
    this.sequence += 1;
    this.turnEndedAt.set(agentId, this.sequence);
    if (!this.runningTurns.delete(agentId)) return;
    await this.scheduler.turnEnded(agentId);
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
    if (scope !== undefined) await this.inbox.fileUndelivered(scope, rows);
    const kept = scope !== undefined && rows.length > 0 && rows.every((row) => row.sentIn === null);
    // The first Route covering the conversation places the notice.
    const noticeRoute = recordedRoute(account, message.conversation, undefined);
    if (noticeRoute === undefined) return;
    await this.deps.plane.notice(message, account, noticeRoute, kept ? "unprocessed" : "refused");
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
    this.scheduler.stop();
    this.runningTurns.clear();
    this.turnEndedAt.clear();
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

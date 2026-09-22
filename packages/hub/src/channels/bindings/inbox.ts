// A binding's inbox (docs/features/channels/conversation-flow.md): the messages
// of one session scope that did not trigger a turn, kept as context for the
// next one, and the messages held back to be sent together. The rows live in
// the durable ingress queue (`db/channel-inbox.ts`), so the inbox survives a
// Hub restart; this module decides what goes in and renders what comes out.
import type { ChannelInboxScope, ChannelInboxStore } from "../../db/channel-inbox.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import type { CompiledRoute } from "../config/compile.js";
import { conversationSettings } from "../config/conversation.js";
import type { InboundMessage } from "../plane/types.js";
import { deliveryMessageId, renderConversationPrompt } from "./prompt.js";
import { deriveBindingKey, type ThreadKey } from "./stored-route.js";

/** One send into a binding's session. */
export interface Delivery {
  /** The message the turn answers: its sender acts, its id anchors the reply. */
  message: InboundMessage;
  /** Held messages sent together, oldest first and ending with `message`.
   * Absent = `message` alone. */
  held?: readonly InboundMessage[] | undefined;
  /** Admitted when it was held: the send does not run the mention and
   * follow-up gates again (the follow-up window may have closed meanwhile). */
  admitted?: boolean | undefined;
}

/** A delivery rendered for the daemon, and what to record once it is taken. */
export interface PreparedDelivery {
  prompt: string;
  /** The daemon receipt key (`deliveryMessageId`). */
  messageId: string;
  /** The prompt is about to reach the daemon: from here its messages are
   * never sent again as context, whatever the outcome. */
  markSent(): Promise<void>;
  /** The session took the prompt: file its messages and the context it read as delivered. */
  settle(): Promise<void>;
}

export interface BindingInboxDeps {
  store: ChannelInboxStore;
  organizationId: string;
  /** A stored ingress row read back as the message it carried. */
  readMessage: (record: ChannelIngressQueueRecord) => InboundMessage | null;
}

/** The binding key as the inbox column spells it. */
export function inboxBindingKey(key: ThreadKey): string {
  return JSON.stringify([key.externalConversationId, key.externalThreadId]);
}

/** The binding key an inbox column holds, back as a thread key. */
export function parseInboxBindingKey(bindingKey: string): ThreadKey | undefined {
  const parsed: unknown = JSON.parse(bindingKey);
  if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return undefined;
  const thread: unknown = parsed[1];
  if (thread !== null && typeof thread !== "string") return undefined;
  return { externalConversationId: parsed[0], externalThreadId: thread };
}

export function messagesOf(delivery: Delivery): readonly InboundMessage[] {
  return delivery.held ?? [delivery.message];
}

function ingressIds(messages: readonly InboundMessage[]): string[] {
  return messages.flatMap((message) =>
    message.ingressId === undefined ? [] : [message.ingressId],
  );
}

export class BindingInbox {
  constructor(private readonly deps: BindingInboxDeps) {}

  scopeOf(message: InboundMessage, route: CompiledRoute): ChannelInboxScope {
    return {
      organizationId: this.deps.organizationId,
      channel: message.channel,
      accountId: message.accountId,
      bindingKey: inboxBindingKey(deriveBindingKey(message, route)),
    };
  }

  /**
   * Render a delivery with the context that waits for it: the binding's kept
   * messages that arrived before its newest message, newest `maxMessages`. A
   * replay of a delivery whose prompt already went out re-reads the rows that
   * prompt carried (`sent_in`), so it renders the same request for the
   * daemon's receipt. A message the queue never held has no inbox.
   */
  async prepare(delivery: Delivery, route: CompiledRoute): Promise<PreparedDelivery> {
    const messages = messagesOf(delivery);
    const messageId = deliveryMessageId(messages);
    const through = messages.at(-1)?.ingressId;
    const prompt = (context: readonly InboundMessage[]) =>
      renderConversationPrompt({ context, messages });
    if (through === undefined) {
      const none = async () => undefined;
      return { prompt: prompt([]), messageId, markSent: none, settle: none };
    }
    const scope = this.scopeOf(delivery.message, route);
    const own = ingressIds(messages);
    const context = await this.contextFor(scope, messageId, own, through, route);
    // Settled are the rows read here: the ones rendered, and the older ones
    // past the cap that no later prompt repeats. A row filed after this read
    // waits for the next prompt.
    const older = await this.deps.store.listIds(scope, { state: "context", before: through });
    const carried = [...own, ...context.map((row) => row.id)];
    return {
      prompt: prompt(this.read(context)),
      messageId,
      markSent: () => this.deps.store.markSent(scope, carried, messageId),
      settle: () => this.deps.store.file(scope, [...carried, ...older], "delivered"),
    };
  }

  /** The context rows a delivery carries: the ones its first prompt carried, or fresh ones. */
  private async contextFor(
    scope: ChannelInboxScope,
    messageId: string,
    own: readonly string[],
    through: string,
    route: CompiledRoute,
  ): Promise<ChannelIngressQueueRecord[]> {
    const carried = await this.deps.store.listSentIn(scope, messageId);
    if (carried.length > 0) return carried.filter((row) => !own.includes(row.id));
    const newest = conversationSettings(route.defaults).context.maxMessages;
    // A row an earlier prompt carried may already be with the Agent: never again.
    return this.deps.store.list(scope, { state: "context", before: through, newest, unsent: true });
  }

  /** True when every message of the delivery already entered the session: a
   * replay of it completes without sending anything. */
  async delivered(delivery: Delivery, route: CompiledRoute): Promise<boolean> {
    const own = ingressIds(messagesOf(delivery));
    if (own.length === 0) return false;
    const states = await this.deps.store.statesOf(this.scopeOf(delivery.message, route), own);
    return states.length === own.length && states.every((row) => row.inboxState === "delivered");
  }

  /**
   * Keep a message that did not trigger a turn — no mention, or the follow-up
   * window closed — for the binding's next trigger, as `context.unmentioned`
   * says: everyone's, only senders the Route admits, or nobody's.
   */
  async keepUnmentioned(
    message: InboundMessage,
    route: CompiledRoute,
    senderAdmitted: () => Promise<boolean>,
  ): Promise<void> {
    if (message.ingressId === undefined) return;
    const { unmentioned } = conversationSettings(route.defaults).context;
    if (unmentioned === "none") return;
    if (unmentioned === "allowed-senders" && !(await senderAdmitted())) return;
    await this.deps.store.file(this.scopeOf(message, route), [message.ingressId], "context");
  }

  /**
   * Rows the queue gave up on. One no prompt ever carried (its session could
   * not start) rides along with the binding's next trigger, whoever sent it.
   * One a prompt carried may already be with the Agent — an unknown outcome is
   * never resent — so it is filed as delivered.
   */
  async fileUndelivered(
    scope: ChannelInboxScope,
    rows: readonly Pick<ChannelIngressQueueRecord, "id" | "sentIn">[],
  ): Promise<void> {
    const unsent = rows.filter((row) => row.sentIn === null).map((row) => row.id);
    const sent = rows.filter((row) => row.sentIn !== null).map((row) => row.id);
    await this.deps.store.file(scope, unsent, "context");
    await this.deps.store.file(scope, sent, "delivered");
  }

  /** A new conversation starts at `message` (`/new`, `/fork`): the context
   * kept before it is never sent to the new session. */
  async closeContext(message: InboundMessage, route: CompiledRoute): Promise<void> {
    if (message.ingressId === undefined) return;
    const scope = this.scopeOf(message, route);
    const kept = await this.deps.store.listIds(scope, {
      state: "context",
      before: message.ingressId,
    });
    await this.deps.store.file(scope, kept, "delivered");
  }

  /** Hold a message back until its binding's batch or running turn lets it go. */
  async hold(message: InboundMessage, route: CompiledRoute): Promise<ChannelInboxScope> {
    const scope = this.scopeOf(message, route);
    await this.deps.store.file(scope, ingressIds([message]), "held");
    return scope;
  }

  /** True while the binding has held messages: a later one queues behind them. */
  async holds(scope: ChannelInboxScope): Promise<boolean> {
    return (await this.deps.store.list(scope, { state: "held", newest: 1 })).length > 0;
  }

  /** The bindings of an account that hold messages. */
  heldBindings(account: {
    organizationId: string;
    channel: string;
    accountId: string;
  }): Promise<string[]> {
    return this.deps.store.listHeldBindings(account);
  }

  /** The binding's held rows, oldest first; `before` = only rows that arrived earlier. */
  heldRows(scope: ChannelInboxScope, before?: string): Promise<ChannelIngressQueueRecord[]> {
    return this.deps.store.list(scope, { state: "held", before });
  }

  /** Stored rows back as messages; a row the plane cannot read is left out. */
  read(records: readonly ChannelIngressQueueRecord[]): InboundMessage[] {
    return records.flatMap((record) => {
      const message = this.deps.readMessage(record);
      return message === null ? [] : [message];
    });
  }
}

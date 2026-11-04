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
import type { ChannelThreadContext, ChannelThreadContextMessage } from "@clisbot/channels-shared";
import {
  deliveryMessageId,
  renderConversationPrompt,
  type ConversationLine,
  type ConversationNote,
} from "./prompt.js";
import { deriveBindingKey, type ThreadKey } from "./stored-route.js";
import { ingressAttempt } from "../ingress/attempt.js";

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

/**
 * The thread block of a prompt, from the snapshot the vertical stored on
 * `carrier`'s ingress row (`ThreadContext`). Whether a prompt carries it at all
 * is `BindingInbox.threadCarrier`'s durable decision. A message the prompt
 * already carries as context or as a message is not repeated.
 */
export function threadLines(
  carrier: InboundMessage | undefined,
  messages: readonly InboundMessage[],
  context: readonly InboundMessage[],
): (ConversationLine | ConversationNote)[] {
  const thread = carrier?.threadContext;
  if (carrier === undefined || thread === undefined) return [];
  const carried = new Set(
    [...context, ...messages].flatMap((message) =>
      message.externalMessageId === undefined ? [] : [message.externalMessageId],
    ),
  );
  const line = (message: ChannelThreadContextMessage): ConversationLine[] =>
    carried.has(message.messageId)
      ? []
      : [
          {
            senderIdentity: `${carrier.channel}:${message.senderId}`,
            ...(message.senderName === undefined ? {} : { senderName: message.senderName }),
            text: message.text,
          },
        ];
  const lines: (ConversationLine | ConversationNote)[] = [];
  if (thread.unavailable !== undefined) {
    lines.push({
      note: `(${unreadPart(thread)} could not be read: ${thread.unavailable}. The message tool's read action can try again.)`,
    });
  }
  if (thread.root !== undefined) lines.push(...line(thread.root));
  if (thread.omitted === "unknown") {
    lines.push({
      note: "(The replies are not shown: the thread is longer than one read covers. The message tool's read action has them.)",
    });
  } else if (thread.omitted !== undefined) {
    lines.push({
      note: `(${thread.omitted} earlier ${thread.omitted === 1 ? "reply is" : "replies are"} not shown; the message tool's read action has them.)`,
    });
  }
  for (const message of thread.recent) lines.push(...line(message));
  return lines.some((entry) => !("note" in entry)) || thread.unavailable !== undefined ? lines : [];
}

/** What part of the thread a snapshot with `unavailable` is missing. */
function unreadPart(thread: ChannelThreadContext): string {
  if (thread.root !== undefined) return "The thread's replies";
  if (thread.recent.length > 0) return "The thread's root post";
  return "The thread's earlier messages";
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
  async prepare(
    delivery: Delivery,
    route: CompiledRoute,
    agentId?: string,
  ): Promise<PreparedDelivery> {
    const messages = messagesOf(delivery);
    const messageId = deliveryMessageId(messages);
    const through = messages.at(-1)?.ingressId;
    if (through === undefined) {
      const none = async () => undefined;
      const prompt = renderConversationPrompt({ context: [], messages });
      return { prompt, messageId, markSent: none, settle: none };
    }
    const scope = this.scopeOf(delivery.message, route);
    const own = ingressIds(messages);
    const context = await this.contextFor(scope, messageId, own, through, route);
    const carrier = await this.threadCarrier(scope, messages, messageId, route, agentId);
    // Settled are the rows read here: the ones rendered, and the older ones
    // past the cap that no later prompt repeats. A row filed after this read
    // waits for the next prompt.
    const older = await this.deps.store.listIds(scope, { state: "context", before: through });
    const carried = [...own, ...context.map((row) => row.id)];
    const read = this.read(context);
    return {
      prompt: renderConversationPrompt({
        thread: threadLines(carrier, messages, read),
        context: read,
        messages,
      }),
      messageId,
      markSent: async () => {
        ingressAttempt.getStore()?.throwIfAborted();
        if (carrier?.ingressId !== undefined && agentId !== undefined) {
          await this.deps.store.markThreadContextSent(scope, carrier.ingressId, {
            agentId,
            deliveryId: messageId,
          });
        }
        return this.deps.store.markSent(scope, carried, messageId);
      },
      settle: async () => {
        if (carrier?.ingressId !== undefined && agentId !== undefined) {
          await this.deps.store.confirmThreadContextSent(scope, carrier.ingressId, messageId);
        }
        await this.deps.store.file(scope, [...carried, ...older], "delivered");
      },
    };
  }

  /**
   * The message whose thread snapshot this prompt carries, or undefined. The
   * decision is durable, per session and native thread. The prompt carrying a
   * snapshot writes a marker on its row with its sent mark, before the send
   * (`markThreadContextSent`), and confirms it once the daemon took the prompt
   * (`settle`). A replay of that prompt finds its own marker, confirmed or not,
   * and carries the thread again, so it is the same request. A later prompt to
   * the same Agent leaves the thread out only after an earlier confirmed
   * marker: a prompt refused before delivery, or one whose outcome stayed
   * unknown, does not count, so the thread is sent again (a possible duplicate,
   * never a loss). A new session (`/new`, a new binding) is another Agent, and
   * rows written before this existed carry no marker.
   */
  private async threadCarrier(
    scope: ChannelInboxScope,
    messages: readonly InboundMessage[],
    deliveryId: string,
    route: CompiledRoute,
    agentId: string | undefined,
  ): Promise<InboundMessage | undefined> {
    if (agentId === undefined) return undefined;
    if (conversationSettings(route.defaults).context.unmentioned === "none") return undefined;
    const carrier = messages.find(
      (message) => message.threadContext !== undefined && message.ingressId !== undefined,
    );
    const threadId = carrier?.conversation.threadId;
    if (carrier?.ingressId === undefined || threadId == null) return undefined;
    const marker = await this.deps.store.threadContextMarkerOf(scope, carrier.ingressId);
    if (marker !== undefined) {
      return marker.agentId === agentId && marker.deliveryId === deliveryId ? carrier : undefined;
    }
    const sent = await this.deps.store.threadContextSentTo(
      scope,
      agentId,
      threadId,
      carrier.ingressId,
    );
    return sent ? undefined : carrier;
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
    ingressAttempt.getStore()?.throwIfAborted();
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
    options: { outcomeUnknown?: boolean } = {},
  ): Promise<void> {
    // A timed-out continuation may not have written sentIn yet. Do not turn
    // uncertainty into an automatic replay in the next prompt.
    if (options.outcomeUnknown) {
      await this.deps.store.file(
        scope,
        rows.map((row) => row.id),
        "delivered",
      );
      return;
    }
    ingressAttempt.getStore()?.throwIfAborted();
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
    ingressAttempt.getStore()?.throwIfAborted();
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

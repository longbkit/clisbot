/**
 * The ingress lane an inbound is admitted to is the session it will reach.
 *
 * A lane runs its rows one at a time, so its scope is a trade: ordering inside
 * it, parallelism across it. Ordering matters exactly where messages share a
 * session, which is what a binding key names (`deriveBindingKey`). A lane wider
 * than the session only lets one stuck message hold up conversations it has
 * nothing to do with — every top-level message of a Slack channel whose Route
 * opens a thread per message used to share one `root` lane. A lane narrower
 * than the session would let two of its messages race.
 *
 * The transport cannot know the session (it depends on the account's Routes),
 * so it admits under its own thread-level key and this narrows or widens it.
 * Admission is before routing and before the sender is resolved, so only what
 * decides the session without a read is used: the Routes whose Where covers the
 * conversation. When they disagree about the key — a Route tier that opens a
 * thread per message above one that keeps one session per channel — or none
 * covers it, the transport's key stands.
 *
 * Commands follow the same rule: a command's lane is the session it acts on,
 * so `/stop` or `/new` stays in order with that session's messages. A command
 * that acts on no session gets a lane of its own, keyed by its event id, so
 * many of them run side by side: on a Route that opens a thread per root
 * message no message binds the root, and a root-level native slash command
 * (Slack's carry no message ts) that only reads — `/help`, `/me`, `/status` —
 * has nothing to wait for. A command that can start or change a session there
 * (`/new <prompt>`, `/fork`, `/stop`, …) acts on the root binding it creates,
 * so it keeps that binding's lane.
 */
import { inboundLaneKey } from "@getpaseo/channels-shared";
import { deriveBindingKey, rootMessagesOpenThreads } from "../bindings/stored-route.js";
import type { ChannelCommandName } from "../commands.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import { routeConversationMatches } from "../policy.js";
import type { InboundMessage } from "../plane/types.js";

/** Commands that start, steer and change no session: they only read or answer. */
const SESSIONLESS_COMMANDS: ReadonlySet<ChannelCommandName> = new Set(["help", "me", "status"]);

/**
 * The lane of the session this message will reach, or undefined when the
 * account's Routes do not settle it before routing. `command` is the command
 * the message carries, if any.
 */
export function sessionLaneKey(
  account: CompiledChannelAccount,
  message: InboundMessage,
  command?: ChannelCommandName,
): string | undefined {
  const routes = account.routes.filter((route) =>
    routeConversationMatches(route, message.conversation),
  );
  const keys = routes.map((route) => deriveBindingKey(message, route));
  const key = keys[0];
  if (key === undefined) return undefined;
  if (keys.some((other) => other.externalThreadId !== key.externalThreadId)) return undefined;
  const lane = { channel: message.channel, accountId: message.accountId };
  const ownId = message.externalMessageId;
  const onNoSession =
    key.externalThreadId === null &&
    routes.every((route) => rootMessagesOpenThreads(message, route));
  if (command !== undefined && SESSIONLESS_COMMANDS.has(command) && onNoSession && ownId) {
    return inboundLaneKey({
      ...lane,
      conversationId: key.externalConversationId,
      threadId: `event:${ownId}`,
    });
  }
  return inboundLaneKey({
    ...lane,
    conversationId: key.externalConversationId,
    threadId: key.externalThreadId,
  });
}

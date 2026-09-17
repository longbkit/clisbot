// `/followup` — whether messages need a mention (clisbot's command of the same
// name). The plain form overrides the Route's `interaction.followUp.mode` for
// this conversation only; `/followup route …` publishes a change to the Route
// itself, for every conversation it serves.
import type { ChannelStore } from "../db/channels.js";
import type { ConversationFollowUpMode } from "../db/channel-follow-ups.js";
import { followUpConversationKey } from "./bindings/follow-up.js";
import { deriveBindingKey } from "./bindings/stored-route.js";
import {
  parseFollowUpArguments,
  type FollowUpCommandAction,
  type RouteFollowUpChange,
} from "./commands-follow-up-arguments.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import { routeDefaultTarget, routeLabel } from "./commands-route-default.js";
import type { ChannelPlaneDeps } from "./plane/types.js";

export interface FollowUpCommandReply {
  text: string;
  /** A Route change was published; apply the revision after the reply is posted. */
  published: boolean;
}

export async function runFollowUpCommand(input: {
  plane: ChannelPlaneDeps;
  store: Pick<ChannelStore, "access">;
  context: LifecycleCommandContext;
  value: string | undefined;
}): Promise<FollowUpCommandReply> {
  const action = parseFollowUpArguments(input.value);
  // The command parser only admits parsed arguments; this guards direct calls.
  if (action === null) return reply(USAGE);
  if (action.scope === "route") return runRouteAction(input, action);
  return reply(await runConversationAction(input, action));
}

const USAGE =
  "Usage: /followup [status|auto|mention-only|pause|resume] · /followup route [auto [minutes]|mention-only]";

async function runConversationAction(
  input: {
    plane: ChannelPlaneDeps;
    store: Pick<ChannelStore, "access">;
    context: LifecycleCommandContext;
  },
  action: Extract<FollowUpCommandAction, { scope: "conversation" }>,
): Promise<string> {
  const { context, store } = input;
  const scope = conversationScope(context);
  if (action.action === "status") {
    const override =
      scope === undefined
        ? undefined
        : await store.access.findConversationFollowUp(conversationKey(input));
    return statusText(context, scope, override?.mode);
  }
  if (scope === undefined) return OUTSIDE_THREAD;
  if (!followUpApplies(context)) return NOT_IN_EFFECT;
  const key = conversationKey(input);
  if (action.action === "resume") {
    await store.access.clearConversationFollowUp(key);
    return `Follow-up for ${scope} reset to the route's \`${context.route.defaults.followUp.mode}\`.`;
  }
  await store.access.setConversationFollowUp(key, {
    mode: action.mode,
    setBy: context.message.senderIdentity,
  });
  return changedText(context, scope, action.mode);
}

async function runRouteAction(
  input: { plane: ChannelPlaneDeps; context: LifecycleCommandContext },
  action: Extract<FollowUpCommandAction, { scope: "route" }>,
): Promise<FollowUpCommandReply> {
  const { plane, context } = input;
  if (action.action === "status") return reply(routeStatusText(context));
  const publisher = plane.routeDefaults;
  if (publisher === undefined) return reply("Route settings cannot be changed on this Hub.");
  const target = await routeDefaultTarget(plane, context);
  if (target === undefined) return reply("/followup route requires channel.manage access here.");
  const outcome = await publisher.setFollowUp(target, action.change);
  if (outcome.status === "outside_access") {
    return reply("This route starts an agent outside your own access, so you cannot change it.");
  }
  if (outcome.status !== "published") {
    return reply(
      "This route changed since this message arrived. Check /followup route, then try again.",
    );
  }
  return {
    text: routeChangedText(context, action.change, outcome.followUp.ttlMinutes),
    published: true,
  };
}

const OUTSIDE_THREAD =
  "Follow-up is set per thread here. Run /followup inside the thread, or change every conversation on this route with /followup route auto [minutes] or /followup route mention-only.";

const NOT_IN_EFFECT =
  "Follow-up has no effect here: this conversation does not require a mention, so every message is already answered.";

/**
 * What a conversation override covers, as the user sees it; undefined when the
 * message would open a new thread (a Slack channel root on a thread-anchored
 * route), where an override would only ever apply to the command's own thread.
 */
function conversationScope(context: LifecycleCommandContext): string | undefined {
  const { message, route } = context;
  const { conversation } = message;
  if (conversation.kind === "dm") return "this DM";
  const key = deriveBindingKey(message, route);
  if (key.externalThreadId !== null && conversation.threadId === null) return undefined;
  if (key.externalThreadId !== null)
    return conversation.kind === "topic" ? "this topic" : "this thread";
  return conversation.kind === "group" ? "this group" : "this channel";
}

function conversationKey(input: { plane: ChannelPlaneDeps; context: LifecycleCommandContext }) {
  return followUpConversationKey(
    input.plane.organizationId,
    input.context.message,
    input.context.route,
  );
}

/** Follow-up only decides unmentioned messages on a route that requires a mention. */
function followUpApplies(context: LifecycleCommandContext): boolean {
  return context.message.conversation.kind !== "dm" && context.route.defaults.requireMention;
}

function changedText(
  context: LifecycleCommandContext,
  scope: string,
  mode: ConversationFollowUpMode,
): string {
  if (mode === "paused") return `Follow-up paused for ${scope} until the next mention.`;
  if (mode === "mention-only") {
    return `Follow-up for ${scope} set to \`mention-only\`: every message must mention the bot.`;
  }
  const minutes = context.route.defaults.followUp.ttlMinutes;
  return `Follow-up for ${scope} set to \`auto\`: after a mention, messages continue without one until ${minutes} minutes after the agent's last turn.`;
}

function routeChangedText(
  context: LifecycleCommandContext,
  change: RouteFollowUpChange,
  ttlMinutes: number | undefined,
): string {
  const label = routeLabel(context);
  const window =
    change.mode === "auto"
      ? ` (${ttlMinutes === undefined ? "the inherited window" : `${ttlMinutes} minutes`} after the agent's last turn)`
      : "";
  return [
    `Follow-up for ${label} set to \`${change.mode}\`${window}.`,
    "Conversations with their own /followup keep it until /followup resume.",
  ].join("\n");
}

function statusText(
  context: LifecycleCommandContext,
  scope: string | undefined,
  override: ConversationFollowUpMode | undefined,
): string {
  const { followUp } = context.route.defaults;
  if (scope === undefined) return `${routeStatusText(context)}\n${OUTSIDE_THREAD}`;
  const mode = override === "paused" ? "mention-only" : (override ?? followUp.mode);
  const lines = [`Follow-up for ${scope}: \`${mode}\``, routeLine(context)];
  if (override !== undefined) {
    lines.push(
      override === "paused"
        ? "- here: `paused` until the next mention (/followup resume clears it)"
        : `- here: \`${override}\` (/followup resume clears it)`,
    );
  }
  if (!followUpApplies(context)) lines.push(`- ${NOT_IN_EFFECT}`);
  return lines.join("\n");
}

function routeStatusText(context: LifecycleCommandContext): string {
  const lines = [`Follow-up for ${routeLabel(context)}`, routeLine(context)];
  lines.push(
    "- change it: /followup route auto [minutes] · /followup route mention-only (channel.manage)",
  );
  if (!context.route.defaults.requireMention)
    lines.push("- not in effect: this route does not require a mention");
  return lines.join("\n");
}

function routeLine(context: LifecycleCommandContext): string {
  const { followUp } = context.route.defaults;
  return `- route: \`${followUp.mode}\`, window ${followUp.ttlMinutes} minutes after the agent's last turn in \`auto\``;
}

function reply(text: string): FollowUpCommandReply {
  return { text, published: false };
}

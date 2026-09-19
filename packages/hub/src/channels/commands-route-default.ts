// `/routedefault` and `/promoteroutedefault`: read and change the default agent
// of the Route serving this conversation. The Route is never named by the
// caller. Routes match by conversation and message text in order, so only the
// Hub knows which one served this message, and that Route is the one changed.

import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type { ChannelConversationKey } from "../db/channel-access.js";
import type { ChannelStore } from "../db/channels.js";
import { routePosition } from "./bindings/index.js";
import { sameAgentControls, type AgentControls } from "./config/agent-controls.js";
import { commandAccessRequest } from "./commands-context.js";
import { commandRefusalText } from "./commands.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import type { CreateAgentConfig } from "./daemon/types.js";
import type { ChannelPlaneDeps } from "./plane/types.js";
import type { RouteDefaultOutcome, RouteDefaultTarget } from "./route-defaults/publish.js";

export interface RouteDefaultCommandDependencies {
  plane: ChannelPlaneDeps;
  store: ChannelStore;
  /** What the Route starts; `override` replaces the Route's default controls. */
  routeConfig(
    context: LifecycleCommandContext,
    override?: { agentControls: AgentControls | undefined },
  ): CreateAgentConfig;
  /** What this conversation uses: its own choice, else its live session, else the Route's. */
  conversationConfig(context: LifecycleCommandContext): Promise<CreateAgentConfig>;
  selectionKey(context: LifecycleCommandContext): ChannelConversationKey;
}

const ROUTE_CHANGED =
  "This route changed since this session started. Check /routedefault, then try again.";

export async function routeDefaultText(
  deps: RouteDefaultCommandDependencies,
  context: LifecycleCommandContext,
): Promise<string> {
  const route = deps.routeConfig(context);
  const conversation = await deps.conversationConfig(context);
  const label = routeLabel(context);
  return [
    capitalize(label),
    `Default: ${configurationText(route)}`,
    ...(sameAgentControls(controlsOf(route), controlsOf(conversation))
      ? []
      : [`This conversation: ${configurationText(conversation)}`]),
  ].join("\n");
}

/** Runs `/promoteroutedefault [undo]`; resolves to the reply to post. */
export async function promoteRouteDefault(
  deps: RouteDefaultCommandDependencies,
  context: LifecycleCommandContext,
  value: string | undefined,
): Promise<{ text: string; published: boolean }> {
  const undo = value?.toLowerCase() === "undo";
  if (value !== undefined && !undo) return reply("Usage: /promoteroutedefault [undo]");
  const publisher = deps.plane.routeDefaults;
  if (publisher === undefined) return reply("Route defaults cannot be changed on this Hub.");
  const target = await routeDefaultTarget(deps.plane, context);
  if (target === undefined)
    return reply(commandRefusalText("/promoteroutedefault", "channel.manage"));
  if (undo) {
    const outcome = await publisher.undo(target);
    if (outcome.status !== "published") return reply(outcomeText(outcome));
    const restored = deps.routeConfig(context, {
      agentControls: outcome.agentControls ?? accountControls(context),
    });
    return published(
      `Default restored for ${routeLabel(context)}: ${configurationText(restored)}.`,
    );
  }
  const conversation = await deps.conversationConfig(context);
  const controls = controlsOf(conversation);
  if (sameAgentControls(controlsOf(deps.routeConfig(context)), controls)) {
    return reply("This conversation already uses the route default.");
  }
  const outcome = await publisher.promote(target, controls);
  if (outcome.status !== "published") return reply(outcomeText(outcome));
  // The conversation's own choice is now the Route's, so it stops overriding it.
  await deps.store.access.clearConversationSelection(deps.selectionKey(context));
  return published(
    [
      `Default set for ${routeLabel(context)}:`,
      configurationText(conversation),
      "New conversations on this route use it. Undo: /promoteroutedefault undo",
    ].join("\n"),
  );
}

/** The Route serving this conversation and the Member changing it; undefined without channel.manage. */
export async function routeDefaultTarget(
  plane: ChannelPlaneDeps,
  context: LifecycleCommandContext,
): Promise<RouteDefaultTarget | undefined> {
  const request = commandAccessRequest(
    plane,
    context.message,
    context.account,
    context.route,
    "channel.manage",
    context.accessTarget,
  );
  const principal = await plane.commandAccess?.authorizeChannelAccountManagement?.(request);
  if (principal === undefined) return undefined;
  return {
    organizationId: plane.organizationId,
    channel: context.account.channel,
    accountId: context.account.accountId,
    position: routePosition(context.account, context.route),
    route: context.route,
    principal,
  };
}

function outcomeText(outcome: Exclude<RouteDefaultOutcome, { status: "published" }>): string {
  if (outcome.status === "nothing_to_undo") return "Nothing to undo for this route.";
  if (outcome.status === "outside_access") {
    return "This configuration is outside your own access, so it cannot be the route default.";
  }
  return ROUTE_CHANGED;
}

/** `route #3 (mention, contains "deploy")`. */
export function routeLabel(context: LifecycleCommandContext): string {
  const position = routePosition(context.account, context.route);
  const traits = [
    ...(context.route.defaults.requireMention ? ["mention"] : []),
    ...(context.route.contains === undefined
      ? []
      : [`contains ${JSON.stringify(context.route.contains)}`]),
  ];
  return `route #${position + 1}${traits.length === 0 ? "" : ` (${traits.join(", ")})`}`;
}

/** `claude / claude-opus-5 / high`, plus the mode when it is not the provider's default. */
function configurationText(config: CreateAgentConfig): string {
  const provider = AGENT_PROVIDER_DEFINITIONS.find(({ id }) => id === config.provider);
  const mode = provider?.modes.find(({ id }) => id === config.modeId);
  const showMode =
    config.modeId !== undefined &&
    (config.modeId !== provider?.defaultModeId || mode?.isUnattended === true);
  return [
    `${config.provider} / ${config.model ?? "default"} / ${config.thinkingOptionId ?? "default"}`,
    ...(showMode
      ? [`permission ${config.modeId}${mode?.isUnattended ? " (unattended)" : ""}`]
      : []),
  ].join(" · ");
}

function controlsOf(config: CreateAgentConfig): AgentControls {
  return {
    provider: config.provider,
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.modeId === undefined ? {} : { mode: config.modeId }),
    ...(config.thinkingOptionId === undefined ? {} : { thinkingOptionId: config.thinkingOptionId }),
    ...(config.featureValues === undefined
      ? {}
      : { featureValues: config.featureValues as AgentControls["featureValues"] }),
  };
}

/** The account layer's controls, which a Route without its own leaf inherits. */
function accountControls(context: LifecycleCommandContext): AgentControls | undefined {
  return context.account.defaults.agentControls;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reply(text: string) {
  return { text, published: false };
}

function published(text: string) {
  return { text, published: true };
}

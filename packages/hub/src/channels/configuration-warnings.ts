// Warnings for wide Routes: any Route that accepts every permission request,
// and open-audience Routes. The configurator may choose any of these
// (docs/audits/2026-09-18-channel-chat-authority-and-limits.md): the
// publish-time delegation check already decides what they may hand out, so
// these are information for the person saving, never a refusal.

import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type { CompiledHubBundle } from "../config/bundle.js";
import type { Database } from "../db/types.js";
import {
  automationAgents,
  compileAutomationDocument,
  editableAutomationYaml,
} from "../triggers/configuration/workflow-document.js";
import { applyAgentControls } from "./config/agent-controls.js";
import type { ChannelControlPlane, CompiledRoute, EffectiveDefaults } from "./config/compile.js";
import type { ApprovalRule } from "./config/schema.js";
import { privilegeCovers } from "./config/privileges.js";
import { autoAllowsEveryToolClass, isOpenAudienceRoute } from "./policy.js";

export interface ChannelConfigurationWarning {
  channel: string;
  accountId: string;
  /** The Route's position in its account's `routes`. */
  route: number;
  message: string;
}

interface WarnedAgent {
  provider: string;
  mode?: string | undefined;
  featureValues?: Readonly<Record<string, unknown>> | undefined;
  options?: Readonly<Record<string, unknown>> | undefined;
}

type TriggerRecords = Awaited<ReturnType<Database["listOrganizationTriggers"]>>;

/** Every warning the active or candidate configuration carries, in Route order. */
export async function channelConfigurationWarnings(input: {
  database: Database;
  organizationId: string;
  bundle: CompiledHubBundle;
  controlPlane: ChannelControlPlane;
  triggers: TriggerRecords;
}): Promise<ChannelConfigurationWarning[]> {
  const warnings: ChannelConfigurationWarning[] = [];
  for (const account of input.controlPlane.accounts) {
    for (const [index, route] of account.routes.entries()) {
      const messages = routeWarnings(route);
      if (isOpenAudienceRoute(route)) {
        const agents = await routeAgents(input, input.triggers, route);
        messages.push(...openRouteWarnings(route), ...agents.flatMap(openAgentWarnings));
      }
      for (const message of messages) {
        warnings.push({
          channel: account.channel,
          accountId: account.accountId,
          route: index,
          message,
        });
      }
    }
  }
  return warnings;
}

/** What any Route, whoever may use it, lets the Agent do unasked. */
export function routeWarnings(route: CompiledRoute): string[] {
  return autoAllowsEveryToolClass(route)
    ? ["Every permission request is accepted automatically."]
    : [];
}

/** What the Route itself lets anyone in the conversation do. The
 * every-request case is `routeWarnings`' and is not repeated here. */
export function openRouteWarnings(route: CompiledRoute): string[] {
  const warnings: string[] = [];
  const open = route.audienceRules.filter(({ who }) => who.anyone);
  const groups = open.map(({ where }) => where.groups).filter((filter) => filter !== undefined);
  if (groups.length > 0) {
    const scope = groups.includes("all")
      ? ""
      : ` ${groups.includes("public") ? "public" : "private"}`;
    warnings.push(`Anyone in any${scope} group chat or channel the bot is in can use this Route.`);
  }
  if (open.some(({ where }) => where.dm)) {
    warnings.push("Anyone who can message the bot directly can use this Route.");
  }
  const inRooms = open.some(
    ({ where }) => where.groups !== undefined || where.conversations.length > 0,
  );
  if (inRooms && !route.defaults.requireMention) {
    warnings.push("The bot answers every message here, not only when it is mentioned.");
  } else if (inRooms && route.defaults.followUp.mode === "auto") {
    warnings.push(
      `After a mention, the bot answers anyone here without one for ${String(route.defaults.followUp.ttlMinutes)} minutes.`,
    );
  }
  if (autoAllowsApprovals(route.approval) && !autoAllowsEveryToolClass(route)) {
    warnings.push(
      "Some permission requests are accepted automatically for anyone in the conversation.",
    );
  }
  if (!sendsFinalAnswerOnly(route.defaults)) {
    warnings.push("Progress, tool calls or streaming are posted, not only the final answer.");
  }
  return warnings;
}

/** What the Agent the Route runs lets anyone in the conversation do. */
export function openAgentWarnings(agent: WarnedAgent | undefined): string[] {
  if (agent === undefined) return ["The Agent configuration for this Route is unknown."];
  const warnings: string[] = [];
  if (agent.featureValues?.["fast_mode"] === true) {
    warnings.push("Fast mode is on for anyone in the conversation.");
  }
  const provider = AGENT_PROVIDER_DEFINITIONS.find(({ id }) => id === agent.provider);
  const mode = provider?.modes.find(({ id }) => id === agent.mode);
  if (agent.mode === undefined) {
    warnings.push("The Agent runs in its provider's default mode.");
  } else if (mode === undefined) {
    warnings.push(`Mode "${agent.mode}" is not a known mode of ${agent.provider}.`);
  } else if (mode.isUnattended === true) {
    warnings.push(`Mode "${agent.mode}" runs tools without asking for approval.`);
  }
  if (agent.featureValues?.["auto_accept"] === true) {
    warnings.push("The Agent accepts tool calls automatically.");
  }
  if (agent.options?.["approval_policy"] === "never") {
    warnings.push("Provider options turn tool approvals off.");
  }
  return warnings;
}

async function routeAgents(
  input: { database: Database; bundle: CompiledHubBundle },
  triggers: TriggerRecords,
  route: CompiledRoute,
): Promise<(WarnedAgent | undefined)[]> {
  if (route.target.kind === "agent") {
    const agent = input.bundle.agents[route.target.agent];
    return [
      agent === undefined ? undefined : applyAgentControls(agent, route.defaults.agentControls),
    ];
  }
  const workflow = route.target.workflow;
  const trigger = triggers.find(({ name }) => name === workflow);
  if (trigger === undefined) return [undefined];
  const revision = await input.database.findOrganizationTriggerRevision(
    trigger.id,
    trigger.activeRevisionId,
  );
  if (revision === undefined) return [undefined];
  try {
    return automationAgents(
      compileAutomationDocument(editableAutomationYaml(revision.yaml, trigger.enabled)),
    );
  } catch {
    // An Automation that no longer compiles is its own problem; this Route
    // still loads and says its Agent is unknown.
    return [undefined];
  }
}

function autoAllowsApprovals(rules: readonly ApprovalRule[]): boolean {
  return ["file", "config", "command", "command.destructive", "channel"].some((toolClass) => {
    const wanted = `approval.${toolClass}`;
    const rule = rules.find(({ match }) =>
      privilegeCovers(match.startsWith("approval.") ? match : `approval.${match}`, wanted),
    );
    return rule?.mode === "auto-allow";
  });
}

function sendsFinalAnswerOnly(defaults: EffectiveDefaults): boolean {
  const { sync } = defaults;
  return (
    defaults.outbound.path === "relay" &&
    sync.finalAnswers &&
    !sync.progress.progressMessage &&
    !sync.toolCalls &&
    sync.threadLink === "none" &&
    (sync.streaming?.mode ?? "off") === "off" &&
    !sync.subagents.finalAnswers &&
    !sync.subagents.progress &&
    !sync.subagents.toolCalls
  );
}

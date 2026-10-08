import { i18n } from "@/i18n/i18next";
import { record } from "../automation-workflow-model";
import { routeAudienceDraft } from "./channel-route-audience";
import { ID_NAMES, rulePlaceLabel, ruleWhoLabel } from "./channel-route-rule-summary";

/** Providers a step may reply through; each one is a `<provider>.reply` output grant. */
export const REPLY_PROVIDERS = ["slack", "telegram", "github", "discord", "linear"] as const;

/** Input sources still available to add: Connection-backed ones only for Organization Admins. */
export function inputSourceOptions(
  allowConnectionInputs: boolean,
  hasChannelInputs: boolean,
  configured: Record<string, unknown>,
): { id: string; value: string; label: string }[] {
  const sources = allowConnectionInputs
    ? [
        ...(hasChannelInputs ? ["slack", "telegram"] : []),
        "manual.run",
        "github.issue_comment",
        "discord.mention",
        "linear.issue_created",
      ]
    : ["manual.run"];
  return sources
    .filter((value) => value === "slack" || value === "telegram" || !(value in configured))
    .map((value) => ({ id: value, value, label: inputLabel(value) }));
}

export function inputLabel(source: string): string {
  switch (source) {
    case "slack":
      return "Slack";
    case "telegram":
      return "Telegram";
    case "manual.run":
      return i18n.t("hub.automations.events.manualApi");
    case "github.issue_comment":
      return i18n.t("hub.automations.events.githubIssueComment.label");
    case "discord.mention":
      return i18n.t("hub.automations.events.discordMention.label");
    case "linear.issue_created":
      return i18n.t("hub.automations.events.linearIssueCreated.label");
    default:
      return source;
  }
}

/** Title of the Add input sheet: the channel being added, the input being edited, or the picker. */
export function inputSheetTitle(
  channelProvider: "slack" | "telegram" | null,
  selectedInput: string | null,
): string {
  if (channelProvider) {
    return i18n.t("hub.automations.workflow.addChannelInput", {
      channel: channelProvider === "slack" ? "Slack" : "Telegram",
    });
  }
  return selectedInput ? inputLabel(selectedInput) : i18n.t("hub.automations.form.addInput");
}

export function stepTitle(step: Record<string, unknown>, index: number): string {
  const prompt = Array.isArray(step.prompt) ? step.prompt : [];
  const text = String(record(prompt[0]).text ?? "")
    .split("\n")[0]
    .trim();
  return text && !text.startsWith("${{")
    ? text.slice(0, 72)
    : i18n.t("hub.automations.workflow.agentStep", { number: index + 1 });
}

/** Providers the step replies through, e.g. `slack, github`; empty when it has no reply grant. */
export function stepReplyProviders(step: Record<string, unknown>): string {
  const grants = Array.isArray(step.allow_outputs) ? step.allow_outputs : [];
  return grants
    .map((grant) => String(record(grant).type))
    .filter((type) => type.endsWith(".reply"))
    .map((type) => type.replace(".reply", ""))
    .join(", ");
}

/** Fields of the step's structured result, e.g. `summary, score`; empty without an output schema. */
export function stepResultFields(step: Record<string, unknown>): string {
  return Object.keys(record(record(record(step.output).schema).properties)).join(", ");
}

/** The Route's Rules, one per clause; ids stand in for names here. */
export function routeSummary(route: Record<string, unknown>): string {
  const parts = routeAudienceDraft(route).map((rule) => {
    const contains = rule.conditions.contains?.trim();
    return [
      rulePlaceLabel(rule, ID_NAMES),
      ruleWhoLabel(rule, ID_NAMES),
      ...(contains ? [i18n.t("hub.automations.workflow.contains", { text: contains })] : []),
    ].join(" · ");
  });
  return parts.join("; ") || i18n.t("hub.automations.workflow.conversationFilter");
}

export function stepDependencies(
  step: Record<string, unknown>,
  steps: Record<string, unknown>[],
): string {
  const references = [
    ...new Set(
      [...JSON.stringify(step).matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const positions = references
    .map((id) => steps.findIndex((candidate) => candidate.id === id) + 1)
    .filter((position) => position > 0);
  return positions.length
    ? i18n.t("hub.automations.workflow.usesResult", { steps: positions.join(", ") })
    : "";
}

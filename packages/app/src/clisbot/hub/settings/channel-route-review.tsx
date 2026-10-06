import { type RouteApprovalChoice } from "./channel-route-form-sections";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { type RouteBotOption } from "../channel-route-bot";
import { type ManagedAgentConfigurationValue } from "./managed-agent-configuration-fields";
import { type RecordValue, type RouteTarget } from "./channel-settings-types";
import { arrayField, stringField } from "./channel-settings-records";
import { routeReplySummary, routeToolRequestSummary } from "./channel-route-behavior-draft";

export interface RouteReviewInput {
  route: RecordValue;
  target: string;
  /** One sentence per audience rule. */
  audience: string[];
  /** The Hub's warnings for this Route, from validating the candidate. */
  warnings: string[];
}

/** The warnings the Hub gave for `route`, wherever it sits in the candidate. */
export function warningsForRoute(
  warnings: { channel: string; accountId: string; route: number; message: string }[] | undefined,
  accounts: RecordValue[],
  route: RecordValue,
): string[] {
  const holder = accounts.find((account) => arrayField(account, "routes").includes(route));
  if (holder === undefined) return [];
  const index = arrayField(holder, "routes").indexOf(route);
  return (warnings ?? [])
    .filter(
      (warning) =>
        warning.channel === stringField(holder, "channel") &&
        warning.accountId === stringField(holder, "accountId") &&
        warning.route === index,
    )
    .map(({ message }) => message);
}

/** One source for the review the owner confirms, so the sheet body and the
 * platform dialog's plain text cannot drift apart. */
function routeReviewFacts(input: RouteReviewInput): { label: string; value: string }[] {
  return [
    { label: "Rules", value: input.audience.join("\n") },
    { label: "Target", value: input.target },
    { label: "Reply method", value: routeReplySummary(input.route) },
    { label: "Permission requests", value: routeToolRequestSummary(input.route) },
    ...(input.warnings.length === 0
      ? []
      : [{ label: "Warnings", value: input.warnings.join("\n") }]),
  ];
}

export function routeReviewMessage(input: RouteReviewInput): string {
  return routeReviewFacts(input)
    .map(({ label, value }) => `${label}: ${value}`)
    .join("\n");
}

/** Labels carry the scan line and values the answer, so a long summary stays readable. */
export function routeReviewBody(input: RouteReviewInput): React.ReactNode {
  return (
    <View style={styles.reviewList}>
      {routeReviewFacts(input).map(({ label, value }) => (
        <View key={label} style={styles.reviewFact}>
          <Text style={styles.reviewLabel}>{label}</Text>
          <Text style={styles.reviewValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function routeConfirmationTitle(
  open: boolean,
  approvalChoice: RouteApprovalChoice,
  isEditing: boolean,
): string {
  if (open) return "Open this Route to anyone in the matching conversations?";
  if (approvalChoice === "auto-allow") return "Accept every permission request automatically?";
  return isEditing ? "Save Route?" : "Activate Route?";
}

export function routeTargetReviewLabel(
  target: RouteTarget,
  automationName: string | null,
  bot: RouteBotOption | null,
  agent: ManagedAgentConfigurationValue,
): string {
  if (target === "automation") return `Automation · ${automationName ?? "Unavailable"}`;
  if (target === "bot") return `Bot · ${bot?.bot.name ?? "Unavailable"}`;
  const model = agent.model.length > 0 ? ` / ${agent.model}` : "";
  return `Agent · ${agent.provider}${model}`;
}

export function channelFormSubmitLabel(isEditing: boolean): string {
  return isEditing ? "Save Route" : "Activate Route";
}

const styles = StyleSheet.create((theme) => ({
  reviewList: {
    gap: theme.spacing[3],
  },
  reviewFact: {
    gap: theme.spacing[0.5],
  },
  reviewLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  reviewValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));

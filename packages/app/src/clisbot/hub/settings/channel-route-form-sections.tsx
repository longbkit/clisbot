import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { ChannelRouteBehavior, ChannelRouteQuestions } from "../channel-configuration";
import { ChoiceRow, RouteBehaviorSwitch, RouteFollowUpFields } from "./channel-route-behavior-rows";

// The Route form follows the Route's own model, a rule: conditions, then what
// happens. Conditions: the Connection, who may talk and where, when the bot
// answers (mention, follow-up, message text). Then what runs and how it runs
// (Permissions, folded Advanced), how it replies, and folded Limits.

export type RouteApprovalChoice = NonNullable<ChannelRouteBehavior["approvalMode"]> | "custom";

const OUTBOUND_PATH_VALUES = ["tool", "relay"];
const OUTBOUND_PATH_LABELS = {
  tool: "Use Channel tool",
  relay: "Text forward",
};
const APPROVAL_VALUES = ["require", "auto-deny", "auto-allow"];
const CUSTOM_APPROVAL_VALUES = ["custom", ...APPROVAL_VALUES];
const APPROVAL_LABELS = {
  custom: "Custom YAML",
  require: "Ask authorized members",
  "auto-deny": "Deny",
  "auto-allow": "Accept automatically",
};
export const QUESTION_VALUES: ChannelRouteQuestions[] = ["ask", "recommended", "agent-decides"];
/** What the Hub does with a question when the Route sets none. */
export const DEFAULT_ROUTE_QUESTIONS: ChannelRouteQuestions = "ask";
const QUESTION_LABELS: Record<ChannelRouteQuestions, string> = {
  ask: "Ask in the conversation",
  recommended: "Pick the recommended answer",
  "agent-decides": "Let the Agent decide",
};

/** One section of the Route form: a heading and one card of fields. */
export function RouteFormSection({
  title,
  info,
  trailing,
  children,
}: {
  title: string;
  info?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} info={info} trailing={trailing}>
      <View style={[settingsStyles.card, styles.card]}>{children}</View>
    </SettingsSection>
  );
}

/**
 * A section that starts folded to a one-line summary. It opens on its own when
 * it already holds a value, so a folded section never hides a setting in use.
 */
export function FoldedRouteFormSection({
  title,
  info,
  summary,
  inUse,
  children,
}: {
  title: string;
  info?: string;
  summary: string;
  inUse: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(inUse);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const state = useMemo(() => ({ expanded: open }), [open]);
  const trailing = useMemo(
    () => (
      <Button size="xs" variant="ghost" onPress={toggle} accessibilityState={state}>
        {open ? "Hide" : "Show"}
      </Button>
    ),
    [open, state, toggle],
  );
  return (
    <RouteFormSection title={title} info={info} trailing={trailing}>
      {open ? children : <Text style={settingsStyles.rowHint}>{summary}</Text>}
    </RouteFormSection>
  );
}

/** A titled group inside a section's card, set off from the fields above it. */
export function RouteFormSubgroup({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.subgroup}>
      <View style={styles.subgroupHeader}>
        <Text style={styles.subgroupTitle}>{title}</Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** A subgroup folded to a one-line summary; it opens on its own when in use. */
export function FoldedRouteFormSubgroup({
  title,
  summary,
  inUse,
  children,
}: {
  title: string;
  summary: string;
  inUse: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(inUse);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const state = useMemo(() => ({ expanded: open }), [open]);
  const trailing = useMemo(
    () => (
      <Button size="xs" variant="ghost" onPress={toggle} accessibilityState={state}>
        {open ? "Hide" : "Show"}
      </Button>
    ),
    [open, state, toggle],
  );
  return (
    <RouteFormSubgroup title={title} trailing={trailing}>
      {open ? children : <Text style={settingsStyles.rowHint}>{summary}</Text>}
    </RouteFormSubgroup>
  );
}

/** When the bot answers in a group: a mention, then a follow-up window. DMs always answer. */
export function RouteTriggerFields({
  dmOnly,
  behavior,
  pending,
  followUpTtlDraft,
  followUpTtlError,
  changeRequireMention,
  changeFollowUpAuto,
  changeFollowUpTtlMinutes,
}: {
  /** Every rule covers DMs only: mention settings do not apply. */
  dmOnly: boolean;
  behavior: ChannelRouteBehavior;
  pending: boolean;
  followUpTtlDraft: string;
  followUpTtlError: string | null;
  changeRequireMention(value: boolean): void;
  changeFollowUpAuto(value: boolean): void;
  changeFollowUpTtlMinutes(value: string): void;
}) {
  if (dmOnly) return null;
  return (
    <>
      <RouteBehaviorSwitch
        label="Require a mention"
        value={behavior.requireMention}
        onChange={changeRequireMention}
        disabled={pending}
      />
      {behavior.requireMention ? (
        <RouteFollowUpFields
          behavior={behavior}
          followUpTtlDraft={followUpTtlDraft}
          followUpTtlError={followUpTtlError}
          pending={pending}
          changeFollowUpAuto={changeFollowUpAuto}
          changeFollowUpTtlMinutes={changeFollowUpTtlMinutes}
        />
      ) : null}
    </>
  );
}

export interface RouteReplyFieldsProps {
  /** Every rule covers DMs only: thread settings do not apply. */
  dmOnly: boolean;
  behavior: ChannelRouteBehavior;
  pending: boolean;
  changeReplyThread(value: boolean): void;
  changeOutboundPath(value: string): void;
  changeFinalAnswers(value: boolean): void;
  changeProgressMessage(value: boolean): void;
  changeTypingIndicator(value: boolean): void;
  changeToolCalls(value: boolean): void;
}

/** How replies reach the conversation. */
export function RouteReplyFields(props: RouteReplyFieldsProps) {
  const { dmOnly, behavior, pending } = props;
  return (
    <>
      {dmOnly ? null : (
        <RouteBehaviorSwitch
          label="Reply in a thread"
          value={behavior.replyAnchor === "thread"}
          onChange={props.changeReplyThread}
          disabled={pending}
        />
      )}
      <ChoiceRow
        label="Reply method"
        values={OUTBOUND_PATH_VALUES}
        selected={behavior.outboundPath}
        labels={OUTBOUND_PATH_LABELS}
        layout="row"
        onChange={props.changeOutboundPath}
        disabled={pending}
      />
      <RelayBehaviorFields {...props} />
    </>
  );
}

function RelayBehaviorFields(props: RouteReplyFieldsProps) {
  const { behavior, pending } = props;
  if (behavior.outboundPath !== "relay") {
    return (
      <Alert
        variant="info"
        title="The Agent controls replies"
        description="The Agent can send text and files from the selected Project to this conversation without a separate approval. File sending requires the Hub to access the Project folder. Text forward is disabled to avoid duplicate replies."
      />
    );
  }
  return (
    <>
      <RouteBehaviorSwitch
        label="Send final answers"
        value={behavior.finalAnswers}
        onChange={props.changeFinalAnswers}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Send progress messages"
        value={behavior.progressMessage}
        onChange={props.changeProgressMessage}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Show typing indicator"
        value={behavior.typingIndicator}
        onChange={props.changeTypingIndicator}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Show tool activity"
        value={behavior.toolCalls}
        onChange={props.changeToolCalls}
        disabled={pending}
      />
    </>
  );
}

/**
 * What happens when the Agent's provider asks for permission, and how its
 * questions are answered. A question is not a permission: the approval choice
 * never decides it, and anyone who may talk to the Route can answer it.
 */
export function RoutePermissionFields({
  approvalChoice,
  questions,
  pending,
  changeApprovalChoice,
  changeQuestions,
}: {
  approvalChoice: RouteApprovalChoice;
  questions: ChannelRouteQuestions;
  pending: boolean;
  changeApprovalChoice(value: string): void;
  changeQuestions(value: string): void;
}) {
  return (
    <>
      <ChoiceRow
        label="Permission requests"
        values={approvalChoice === "custom" ? CUSTOM_APPROVAL_VALUES : APPROVAL_VALUES}
        selected={approvalChoice}
        labels={APPROVAL_LABELS}
        onChange={changeApprovalChoice}
        disabled={pending}
      />
      <ChoiceRow
        label="Questions from the Agent"
        values={QUESTION_VALUES}
        selected={questions}
        labels={QUESTION_LABELS}
        onChange={changeQuestions}
        disabled={pending}
      />
    </>
  );
}

/** The Route list's words for a permission choice. */
export function approvalSummary(
  approvalChoice: RouteApprovalChoice,
  questions: ChannelRouteQuestions | undefined,
): string {
  const requests = APPROVAL_SUMMARIES[approvalChoice];
  if (questions === "recommended") return `${requests}, recommended answers picked`;
  if (questions === "agent-decides") return `${requests}, the Agent answers its questions`;
  return requests;
}

const APPROVAL_SUMMARIES: Record<RouteApprovalChoice, string> = {
  require: "Ask for approval",
  "auto-deny": "Requests denied",
  "auto-allow": "Requests accepted automatically",
  custom: "Custom approvals",
};

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  subgroup: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  subgroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  subgroupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));

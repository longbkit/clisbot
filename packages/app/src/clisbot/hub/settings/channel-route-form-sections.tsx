import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { ChannelRouteBehavior, ChannelRouteQuestions } from "../channel-configuration";
import { ChoiceRow, RouteBehaviorSwitch } from "./channel-route-behavior-rows";
import {
  RouteToolActivityFields,
  type RouteToolActivityForm,
} from "./channel-route-tool-activity-fields";

// The Route form follows the Route's own model: a destination and its ways in.
// First the Connection and the Rules (where, who, and when a message gets in:
// a mention, a follow-up, message text). Then what runs and how it runs
// (Permissions, folded Advanced), how it replies, then the folded sections
// most Routes leave at their defaults: Limits and Incoming messages.

export type RouteApprovalChoice = NonNullable<ChannelRouteBehavior["approvalMode"]> | "custom";

const OUTBOUND_PATH_VALUES = ["hybrid", "relay", "tool"];
const OUTBOUND_PATH_LABELS = {
  hybrid: "Hybrid",
  relay: "Text forward",
  tool: "Channel tool only",
};
const OUTBOUND_PATH_DESCRIPTIONS = {
  hybrid: "The answer as text, plus files, reactions and edits through the Channel tool",
  relay: "The answer as text only",
  tool: "The Agent sends what it chooses through the Channel tool",
};
const APPROVAL_VALUES = ["require", "auto-deny", "auto-allow"];
const CUSTOM_APPROVAL_VALUES = ["custom", ...APPROVAL_VALUES];
const APPROVAL_LABELS = {
  custom: "Custom YAML",
  require: "Ask authorized members",
  "auto-deny": "Deny",
  "auto-allow": "Accept automatically",
};
const APPROVAL_DESCRIPTIONS = {
  custom: "The rules written in this Route's YAML",
  require: "Someone with approval rights answers in the conversation",
  "auto-deny": "Every request is refused; the Agent goes on without it",
  "auto-allow": "Every request is allowed",
};
export const QUESTION_VALUES: ChannelRouteQuestions[] = ["ask", "recommended", "agent-decides"];
/** What the Hub does with a question when the Route sets none. */
export const DEFAULT_ROUTE_QUESTIONS: ChannelRouteQuestions = "ask";
const QUESTION_LABELS: Record<ChannelRouteQuestions, string> = {
  ask: "Ask in the conversation",
  recommended: "Pick the recommended answer",
  "agent-decides": "Let the Agent decide",
};
const QUESTION_DESCRIPTIONS: Record<ChannelRouteQuestions, string> = {
  ask: "Anyone this Route lets in can answer",
  recommended: "The option marked recommended is picked, else the first",
  "agent-decides": "The Agent is told nobody can answer and picks for itself",
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
  // Inset by the card's padding, so Show and Hide stand over the cards'
  // own controls instead of past them.
  const trailing = useMemo(
    () => (
      <View style={styles.sectionTrailing}>
        <Button size="xs" variant="ghost" onPress={toggle} accessibilityState={state}>
          {open ? "Hide" : "Show"}
        </Button>
      </View>
    ),
    [open, state, toggle],
  );
  const foldedTrailing = useMemo(
    () => (
      <View style={styles.foldedTrailing}>
        <Text style={styles.foldedSummary} numberOfLines={1}>
          {summary}
        </Text>
        {trailing}
      </View>
    ),
    [summary, trailing],
  );
  if (open) {
    return (
      <RouteFormSection title={title} info={info} trailing={trailing}>
        {children}
      </RouteFormSection>
    );
  }
  // Folded, it is one line: the title, what it holds, and Show. No card around
  // a summary that has nothing to edit.
  return (
    <SettingsSection
      title={title}
      info={info}
      style={styles.foldedSection}
      trailing={foldedTrailing}
    >
      {null}
    </SettingsSection>
  );
}

/** A titled group inside a section's card, set off from the fields above it. */
export function RouteFormSubgroup({
  title,
  info,
  trailing,
  children,
}: {
  title: string;
  /** What the subgroup does, in its title's info tip rather than a paragraph. */
  info?: string;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.subgroup}>
      <View style={styles.subgroupHeader}>
        <View style={styles.subgroupTitleRow}>
          <Text style={styles.subgroupTitle}>{title}</Text>
          {info === undefined ? null : <SettingsInfoTip title={title} info={info} />}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** A subgroup folded to a one-line summary; it opens on its own when in use. */
export function FoldedRouteFormSubgroup({
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
      <Button
        size="xs"
        variant="ghost"
        onPress={toggle}
        accessibilityState={state}
        accessibilityLabel={`${open ? "Hide" : "Show"} ${title}`}
      >
        {open ? "Hide" : "Show"}
      </Button>
    ),
    [open, state, title, toggle],
  );
  const foldedTrailing = useMemo(
    () => (
      <View style={styles.foldedTrailing}>
        <Text style={styles.foldedSummary} numberOfLines={1}>
          {summary}
        </Text>
        {trailing}
      </View>
    ),
    [summary, trailing],
  );
  // Folded, it is one line, as a folded section is: the title, what it holds, and Show.
  const tip = info === undefined ? {} : { info };
  if (!open) return <RouteFormSubgroup title={title} {...tip} trailing={foldedTrailing} />;
  return (
    <RouteFormSubgroup title={title} {...tip} trailing={trailing}>
      {children}
    </RouteFormSubgroup>
  );
}

export interface RouteReplyFieldsProps {
  /** The kinds of place the Route's Rules cover: each has its own thread choice. */
  places: { dms: boolean; groups: boolean };
  behavior: ChannelRouteBehavior;
  pending: boolean;
  changeReplyThread(value: boolean): void;
  changeDmReplyThread(value: boolean): void;
  changeOutboundPath(value: string): void;
  changeFinalAnswers(value: boolean): void;
  changeProgressMessage(value: boolean): void;
  changeTypingIndicator(value: boolean): void;
  /** Show tool activity and its options, a leaf of its own (`sync.toolCalls`). */
  toolActivity: RouteToolActivityForm;
}

/** How replies reach the conversation. */
export function RouteReplyFields(props: RouteReplyFieldsProps) {
  const { places, behavior, pending } = props;
  // Named by place only when the Route covers both: one switch reads plainly.
  const both = places.dms && places.groups;
  return (
    <>
      {places.groups ? (
        <RouteBehaviorSwitch
          label={both ? "Reply in a thread in group chats" : "Reply in a thread"}
          value={behavior.replyAnchor === "thread"}
          onChange={props.changeReplyThread}
          disabled={pending}
        />
      ) : null}
      {places.dms ? (
        <RouteBehaviorSwitch
          label={both ? "Reply in a thread in DMs" : "Reply in a thread"}
          value={behavior.dmReplyAnchor === "thread"}
          onChange={props.changeDmReplyThread}
          disabled={pending}
        />
      ) : null}
      <ChoiceRow
        label="Reply method"
        values={OUTBOUND_PATH_VALUES}
        selected={behavior.outboundPath}
        labels={OUTBOUND_PATH_LABELS}
        descriptions={OUTBOUND_PATH_DESCRIPTIONS}
        onChange={props.changeOutboundPath}
        disabled={pending}
      />
      <RelayBehaviorFields {...props} />
    </>
  );
}

function RelayBehaviorFields(props: RouteReplyFieldsProps) {
  const { behavior, pending } = props;
  if (behavior.outboundPath === "tool") {
    return (
      <Alert
        variant="info"
        title="The Agent controls replies"
        description="The Agent can send text and files from the selected Project to this conversation without a separate approval. File sending requires the Hub to access the Project folder. Text forward is disabled to avoid duplicate replies. If the Agent ends without replying, its last message is sent instead."
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
      <RouteToolActivityFields {...props.toolActivity} pending={pending} />
      <RouteBehaviorSwitch
        label="Show typing indicator"
        value={behavior.typingIndicator}
        onChange={props.changeTypingIndicator}
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
        descriptions={APPROVAL_DESCRIPTIONS}
        onChange={changeApprovalChoice}
        disabled={pending}
      />
      <ChoiceRow
        label="Questions from the Agent"
        values={QUESTION_VALUES}
        selected={questions}
        labels={QUESTION_LABELS}
        descriptions={QUESTION_DESCRIPTIONS}
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
  // The header's own bottom margin already spaces a folded line from the next.
  foldedSection: { marginBottom: theme.spacing[3] },
  // The card's padding and border (`card` above).
  sectionTrailing: { paddingRight: theme.spacing[4] + 1 },
  // No top margin, unlike a row hint: it sits on the title's line.
  foldedSummary: {
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
  },
  foldedTrailing: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: theme.spacing[3],
  },
  // Spacing alone sets a subgroup off: it reads as more rows of the same card.
  subgroup: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  subgroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  subgroupTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  subgroupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

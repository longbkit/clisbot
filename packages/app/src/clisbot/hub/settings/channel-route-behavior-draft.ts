import {
  approvalSummary,
  QUESTION_VALUES,
  type RouteApprovalChoice,
} from "./channel-route-form-sections";
import { initialChannelReplyAnchor, initialDmReplyAnchor } from "../channel-onboarding";
import {
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  channelOutboundPath,
  type ChannelRouteBehavior,
  type ChannelRouteQuestions,
} from "../channel-configuration";
import { type RecordValue } from "./channel-settings-types";
import { arrayField, objectField, stringField } from "./channel-settings-records";

export function routeBehaviorDraft(route: RecordValue | undefined): {
  behavior: ChannelRouteBehavior;
  approvalChoice: RouteApprovalChoice;
} {
  const reply = objectField(route ?? {}, "reply") ?? {};
  const outbound = objectField(route ?? {}, "outbound") ?? {};
  const sync = objectField(route ?? {}, "sync") ?? {};
  const progress = objectField(sync, "progress");
  const approval = arrayField(route ?? {}, "approval").filter(
    (value): value is RecordValue =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );
  const approvalMode =
    approval.length === 1 && stringField(approval[0], "match") === "*"
      ? stringField(approval[0], "mode")
      : null;
  const approvalChoice = routeApprovalChoice(approvalMode, approval.length);
  return {
    behavior: {
      replyAnchor: initialChannelReplyAnchor(route !== undefined, stringField(reply, "anchor")),
      ...initialDmReplyAnchor(route !== undefined, stringField(reply, "dmAnchor")),
      ...routeOutboundPath(route !== undefined, stringField(outbound, "path")),
      finalAnswers: booleanValue(sync["finalAnswers"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.finalAnswers),
      progressMessage: routeProgressMessage(progress, sync),
      typingIndicator: booleanValue(
        progress?.["typingIndicator"],
        DEFAULT_MEMBER_ROUTE_BEHAVIOR.typingIndicator,
      ),
      ...(approvalChoice === "custom" ? {} : { approvalMode: approvalChoice }),
      ...routeQuestions(route),
    },
    approvalChoice,
  };
}

/** Only an unsaved Route follows the current default; a stored path wins, and
 * a stored Route without one keeps inheriting it. */
function routeOutboundPath(
  stored: boolean,
  path: string | null,
): Pick<ChannelRouteBehavior, "outboundPath" | "outboundPathInherited"> {
  const authored = channelOutboundPath(path);
  if (authored !== undefined) return { outboundPath: authored };
  return {
    outboundPath: DEFAULT_MEMBER_ROUTE_BEHAVIOR.outboundPath,
    ...(stored ? { outboundPathInherited: true } : {}),
  };
}

function routeApprovalChoice(
  approvalMode: string | null,
  approvalCount: number,
): RouteApprovalChoice {
  if (approvalMode === "auto-deny" || approvalMode === "auto-allow" || approvalMode === "require") {
    return approvalMode;
  }
  if (approvalCount > 0) return "custom";
  return DEFAULT_MEMBER_ROUTE_BEHAVIOR.approvalMode!;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function routeProgressMessage(progress: RecordValue | null, sync: RecordValue): boolean {
  const progressMessage = progress?.["progressMessage"];
  if (typeof progressMessage === "boolean") return progressMessage;
  return booleanValue(sync["progress"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.progressMessage);
}

/** The Route's `questions:` leaf as loaded; absent when it authors none. */
function routeQuestions(route: RecordValue | undefined): { questions?: ChannelRouteQuestions } {
  const questions = QUESTION_VALUES.find((value) => value === stringField(route, "questions"));
  return questions === undefined ? {} : { questions };
}

/** The behavior a save writes: Custom YAML keeps the Route's own approval rules. */
export function behaviorWithApprovalChoice(
  behavior: ChannelRouteBehavior,
  approvalChoice: RouteApprovalChoice,
): ChannelRouteBehavior {
  const { approvalMode: _, ...settings } = behavior;
  return approvalChoice === "custom" ? settings : { ...settings, approvalMode: approvalChoice };
}

const ROUTE_REPLY_SUMMARIES: Record<ChannelRouteBehavior["outboundPath"], string> = {
  hybrid: "Hybrid: text answers, plus the Channel tool for files and actions",
  relay: "Text forward",
  tool: "Channel tool only: text and Project files, preapproved",
};

export function routeReplySummary(route: RecordValue): string {
  const { outboundPath, outboundPathInherited } = routeBehaviorDraft(route).behavior;
  if (outboundPathInherited === true) return "Inherited from the Connection or organization";
  return ROUTE_REPLY_SUMMARIES[outboundPath];
}

export function routeToolRequestSummary(route: RecordValue): string {
  const { behavior, approvalChoice } = routeBehaviorDraft(route);
  return approvalSummary(approvalChoice, behavior.questions);
}

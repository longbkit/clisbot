// Fusion-owned host adapter for `src/infra/exec-approval-reply.ts` (D-CORE-258).
//
// Upstream's module builds the whole exec-approval presentation: action
// descriptors, pending reply payloads, approver DM notices, decision gating and
// the approval-store lookups behind them. Fusion's Hub owns approvals, so only
// the pure `/approve <id> <decision>` command parser the ported Slack block
// renderer calls is carried, with upstream's body.
import { expectDefined } from "../normalization-core/expect.js";
import { normalizeOptionalLowercaseString } from "../normalization-core/string-coerce.js";

export type ExecApprovalReplyDecision = "allow-once" | "allow-always" | "deny";

export function parseExecApprovalCommandText(
  raw: string,
): { approvalId: string; decision: ExecApprovalReplyDecision } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^\/?approve(?:@[^\s]+)?\s+([A-Za-z0-9][A-Za-z0-9._:-]*)\s+(allow-once|allow-always|always|deny)\b/i,
  );
  if (!match) {
    return null;
  }
  const rawDecision = normalizeOptionalLowercaseString(match[2]) ?? "";
  return {
    approvalId: expectDefined(match[1], "exec approval reply regex capture 1"),
    decision:
      rawDecision === "always" ? "allow-always" : (rawDecision as ExecApprovalReplyDecision),
  };
}

// Fusion-owned boundary for `src/plugin-sdk/approval-reply-runtime.ts` (D-CORE-259).
//
// Upstream's barrel is the exec/plugin approval reply surface (presentations,
// pending payloads, decision gating, approver notices). Fusion's Hub owns
// approvals; only the command-text parser the ported Slack block renderer calls
// is carried, from the host adapter for the same source module.
export {
  parseExecApprovalCommandText,
  type ExecApprovalReplyDecision,
} from "../infra/exec-approval-reply.host-adapter.js";

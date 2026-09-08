// upstream: src/infra/approval-types.ts@5d8067a4483
// Approval kind is shared by exec and plugin approval routing surfaces.

export type ChannelApprovalKind = "exec" | "plugin" | "system-agent";
export type ApprovalRequestChannelRouteClass = "bound-or-explicit" | "unbound";

// D-CORE-213: the upstream module also declares `ApprovalRequestInput`,
// `ApprovalRequest`, `NormalizedApprovalRequest` and the request normalizers over
// OpenClaw's exec / plugin / system-agent approval request shapes. Those live in
// the OpenClaw gateway approval graph, which Fusion's Hub owns. Only the kind
// union the ported `interactive/payload.ts` reads is carried; see upstream-sync.json.

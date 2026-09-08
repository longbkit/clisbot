// Fusion-owned host adapter for `src/routing/bound-account-read.ts` (D-CORE-045).
//
// Upstream scans OpenClaw's per-agent channel bindings on disk to find which
// account is already bound to a peer. Fusion keeps bindings in the Hub and
// resolves the account before the tool runs, so this lookup reports "not bound
// here" instead of consulting a second source of truth.
export function resolveFirstBoundAccountId(_params: {
  cfg: unknown;
  channelId: string;
  agentId: string;
  peerId?: string;
  exactPeerIdAliases?: readonly string[];
  peerKind?: string;
}): string | undefined {
  return undefined;
}

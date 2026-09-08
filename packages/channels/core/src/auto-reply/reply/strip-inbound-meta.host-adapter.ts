// Fusion-owned host adapter for `src/auto-reply/reply/strip-inbound-meta.ts` (D-CORE-051).
//
// Upstream strips the inbound metadata header OpenClaw prepends to a prompt
// (sender, channel, timestamp sentinel) back out of model-authored text. Fusion's
// Hub composes the agent prompt itself and does not use that sentinel, so there is
// nothing to detect or remove.
export function hasInboundMetadataSentinel(_text: string): boolean {
  return false;
}

export function stripInboundMetadata(text: string): string {
  return text;
}

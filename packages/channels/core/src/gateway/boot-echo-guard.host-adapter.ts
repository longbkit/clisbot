// Fusion-owned host adapter for `src/gateway/boot-echo-guard.ts` (D-CORE-049).
//
// Upstream suppresses the boot banner OpenClaw's Gateway injects into a session
// from being echoed back into a channel. Fusion's Hub never injects a boot
// message into an agent session, so there is no echo to strip.
export function getBootEchoContextForSession(_sessionKey?: string | null): undefined {
  return undefined;
}

export function stripBootEchoFromOutboundText(text: string, _context?: unknown): string {
  return text;
}

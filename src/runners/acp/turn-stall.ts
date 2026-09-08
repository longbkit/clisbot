export const DEFAULT_ACP_TURN_STALL_TIMEOUT_MS = 5 * 60_000;

export class AcpTurnStalledError extends Error {
  constructor(sessionName: string, stallTimeoutMs: number) {
    const stallLabel =
      stallTimeoutMs >= 1000
        ? `${Math.round(stallTimeoutMs / 1000)}s`
        : `${stallTimeoutMs}ms`;
    super(
      `ACP turn for "${sessionName}" produced no activity for ${stallLabel} and was cancelled. The runner most likely hit a provider, quota, or auth failure it never reported. Resend the message; if it keeps happening, check the agent CLI's own logs and credentials.`,
    );
    this.name = "AcpTurnStalledError";
  }
}

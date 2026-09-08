// upstream: src/routing/session-key.ts@5d8067a4483
// D-CORE-228: upstream encodes the whole delivery route into an OpenClaw session
// key (channel, peer kind, peer id, thread, account, ACP scheme) and parses it
// back. Fusion's Hub passes the route explicitly, so only the two helpers the
// ported channel code calls are carried. `normalizeAccountId` is upstream's own,
// re-exported from the ported `routing/account-id.ts`.
export { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId } from "./account-id.js";

/** True when the session key names an ACP (agent client protocol) session. */
export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  return typeof sessionKey === "string" && sessionKey.startsWith("acp:");
}

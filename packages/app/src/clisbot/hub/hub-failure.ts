/**
 * What a failed Hub request means for the user. Only an explicit answer from a reachable Hub
 * changes access: 401 asks to sign in to that Hub again, 403 means access was removed. Anything
 * else (offline, VPN, timeout, 5xx) is "unreachable" and must never hide or wipe data.
 */
export type HubFailureKind = "unreachable" | "needs-sign-in" | "revoked";

export function classifyHubFailure(error: unknown): HubFailureKind {
  const status = typeof error === "object" && error !== null ? Reflect.get(error, "status") : null;
  if (status === 401) return "needs-sign-in";
  if (status === 403) return "revoked";
  return "unreachable";
}

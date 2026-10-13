import type { HubLocalStartStatus } from "@clisbot/protocol/hub-local";
export type HubStartAvailability =
  | HubLocalStartStatus
  | { status: "checking" | "unknown" | "offline" | "locked" | "no_host" | "check_failed" };
/** Authority is preserved verbatim; connection and editing state explain why it cannot be used. */
export function hubStartAvailability(input: {
  selected: boolean;
  connected: boolean;
  locked: boolean;
  reported: HubLocalStartStatus | { status: "unknown" | "checking" | "check_failed" };
}): HubStartAvailability {
  if (input.locked) return { status: "locked" };
  if (!input.selected) return { status: "no_host" };
  if (!input.connected) return { status: "offline" };
  return input.reported;
}
export function hubStartReason(value: HubStartAvailability): string {
  return value.status === "blocked" ? value.reason : value.status;
}

export function hubStartReasonKey(value: HubStartAvailability): string {
  return value.status === "check_failed"
    ? "hub.connection.inventory.failed"
    : `hub.connection.startHelp.reasons.${hubStartReason(value)}`;
}
export function hubStartRecoveryReason(value: HubStartAvailability): string {
  return value.status === "check_failed" ? "checking" : hubStartReason(value);
}

export function reconcileLegacyHubStartStatus(input: {
  reported: HubLocalStartStatus;
  devicePairing: boolean;
  membership?: { state: string; hubOrigin?: string | null };
  failed: boolean;
}): HubLocalStartStatus | { status: "checking" | "check_failed" | "unknown" } {
  if (input.reported.status !== "blocked" || input.reported.reason !== "managed_access")
    return input.reported;
  if (input.failed) return { status: "check_failed" };
  if (!input.membership) return { status: "checking" };
  if (input.membership.state !== "not_connected" || input.membership.hubOrigin !== null)
    return input.reported;
  return input.devicePairing
    ? { status: "unknown" }
    : { status: "blocked", reason: "device_pairing_required" };
}

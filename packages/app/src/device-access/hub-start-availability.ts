import type { HubLocalStartStatus } from "@clisbot/protocol/hub-local";
export type HubStartAvailability =
  | HubLocalStartStatus
  | { status: "checking" | "unknown" | "offline" | "locked" | "no_host" };
/** Authority is preserved verbatim; connection and editing state explain why it cannot be used. */
export function hubStartAvailability(input: {
  selected: boolean;
  connected: boolean;
  locked: boolean;
  reported: HubLocalStartStatus | { status: "unknown" | "checking" };
}): HubStartAvailability {
  if (input.locked) return { status: "locked" };
  if (!input.selected) return { status: "no_host" };
  if (!input.connected) return { status: "offline" };
  return input.reported;
}
export function hubStartReason(value: HubStartAvailability): string {
  return value.status === "blocked" ? value.reason : value.status;
}

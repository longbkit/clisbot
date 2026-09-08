/**
 * The operator's half of `access.dmPolicy: pairing`.
 *
 * A stranger who direct-messages a paired account is shown a short code and
 * parked; an operator approving them is what grants access, so the queue is a
 * decision list, not a notification feed. The code is the only way to tell one
 * waiting stranger from another, so it leads every row.
 *
 * A denial is final on the Hub — the row keeps its decision and the sender
 * cannot re-request — so a decided row stays visible and offers no action.
 */
import type { HubChannelPairing } from "./contracts";

export type ChannelPairingStatus = HubChannelPairing["status"];

export interface ChannelPairingRow {
  /** One request per sender per account; the sender identity is the key. */
  senderIdentity: string;
  title: string;
  /** The code the sender is looking at, and where they asked from. */
  detail: string;
  statusLabel: string;
  status: ChannelPairingStatus;
  /** Only a pending request can be decided; a decision is final. */
  decidable: boolean;
}

const STATUS_LABELS: Readonly<Record<ChannelPairingStatus, string>> = {
  pending: "Waiting",
  approved: "Approved",
  denied: "Denied",
};

const STATUS_ORDER: Readonly<Record<ChannelPairingStatus, number>> = {
  pending: 0,
  approved: 1,
  denied: 2,
};

/** Waiting requests first, then the decided ones, newest request first. */
export function channelPairingRows(
  pairings: readonly HubChannelPairing[],
): readonly ChannelPairingRow[] {
  return [...pairings]
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .map((pairing) => ({
      senderIdentity: pairing.senderIdentity,
      title: pairing.senderName ?? pairing.senderIdentity,
      detail: `Code ${pairing.code} · ${pairing.senderIdentity} · in ${pairing.externalConversationId}`,
      statusLabel: STATUS_LABELS[pairing.status],
      status: pairing.status,
      decidable: pairing.status === "pending",
    }));
}

export function pendingChannelPairings(
  rows: readonly ChannelPairingRow[],
): readonly ChannelPairingRow[] {
  return rows.filter((row) => row.decidable);
}

/** The one line the Access section shows before anyone expands the queue. */
export function channelPairingSummary(rows: readonly ChannelPairingRow[]): string {
  const waiting = pendingChannelPairings(rows).length;
  if (rows.length === 0) return "No one has asked to use this account.";
  if (waiting === 0) return "Every pairing request has been decided.";
  return `${String(waiting)} ${waiting === 1 ? "person is" : "people are"} waiting for a decision.`;
}

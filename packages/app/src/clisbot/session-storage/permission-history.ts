import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";

/** A stale fetch must never undo an already observed terminal acknowledgement. */
export function mergePermissionHistory(
  current: readonly AgentPermissionResponseRecord[],
  incoming: readonly AgentPermissionResponseRecord[],
): AgentPermissionResponseRecord[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const previous = records.get(record.id);
    if (previous && previous.status !== "pending") continue;
    records.set(record.id, record);
  }
  return [...records.values()].sort(
    (left, right) =>
      right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id),
  );
}

export function permissionActivityLabel(record: AgentPermissionResponseRecord): string {
  if (record.status === "pending") return "Response not confirmed";
  if (record.status === "failed") return "Permission response failed";
  return record.response.behavior === "allow" ? "Allowed" : "Denied";
}

/** A reused tool ID is insufficient: history must own the saved canonical source row. */
export function permissionBelongsToTool(
  record: AgentPermissionResponseRecord,
  toolCallId: string,
  position?: {
    epoch: string;
    sourceSeqRanges?: readonly { startSeq: number; endSeq: number }[];
  },
): boolean {
  const anchor = record.toolCallCursor;
  return Boolean(
    anchor &&
    position &&
    record.toolCallId === toolCallId &&
    anchor.epoch === position.epoch &&
    position.sourceSeqRanges?.some(
      (range) => range.startSeq <= anchor.seq && anchor.seq <= range.endSeq,
    ),
  );
}

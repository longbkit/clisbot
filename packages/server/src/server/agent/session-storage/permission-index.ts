import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import type { JournalEntry } from "./paged-journal.js";
import { AMBIGUOUS_ID, type SessionEventStream } from "./session-event-log.js";

/** The canonical index already maps a permission id to its newest record. */
export async function findPermissionEntry(
  stream: SessionEventStream<AgentPermissionResponseRecord>,
  id: string,
): Promise<JournalEntry<AgentPermissionResponseRecord> | undefined> {
  const seq = await stream.owner.lookupId("permission", id);
  if (seq === undefined || seq === AMBIGUOUS_ID) return undefined;
  return (await stream.read(seq, seq))[0];
}

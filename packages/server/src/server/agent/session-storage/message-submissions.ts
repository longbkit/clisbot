import { isDeepStrictEqual } from "node:util";
import type { SessionOperationIdentity } from "../session-authorship.js";
import type { JournalOperation } from "./paged-journal.js";
import { AMBIGUOUS_ID, type SessionEventStream } from "./session-event-log.js";

export interface MessageSubmission {
  operation?: JournalOperation;
  id: string;
  digest: string;
  identity: SessionOperationIdentity;
  timestamp: string;
  status: "pending" | "applied";
}

export async function readMessageSubmission(
  stream: SessionEventStream<MessageSubmission>,
  id: string,
): Promise<MessageSubmission | undefined> {
  const seq = await stream.owner.lookupId("submission", id);
  if (seq === undefined || seq === AMBIGUOUS_ID) return undefined;
  return (await stream.read(seq, seq))[0]?.value;
}

/** Caller holds the per-session lease through lookup and append. */
export async function writeMessageSubmission(
  stream: SessionEventStream<MessageSubmission>,
  input: MessageSubmission,
): Promise<{ record: MessageSubmission; created: boolean }> {
  // Round-trip through JSON so an explicit `undefined` cannot differ from the persisted record.
  input = JSON.parse(JSON.stringify(input)) as MessageSubmission;
  const previous = await readMessageSubmission(stream, input.id);
  if (
    previous &&
    (previous.digest !== input.digest || !isDeepStrictEqual(previous.identity, input.identity))
  ) {
    throw new Error("Logical message ID conflicts with its immutable content or sender");
  }
  if (previous?.status === "applied" || (previous && input.status === "pending"))
    return { record: previous, created: false };
  if (!previous && input.status === "applied") throw new Error("Message was not durably admitted");
  const record = previous ? { ...previous, status: input.status } : input;
  const seq = (await stream.state()).maxSeq + 1;
  await stream.append([
    { seq, value: record, ...(record.operation ? { operation: record.operation } : {}) },
  ]);
  return { record, created: !previous };
}

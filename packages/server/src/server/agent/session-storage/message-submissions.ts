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
  /**
   * The provider provably never received this pending message, so it may be admitted again. A flag
   * rather than a status so a rolled-back daemon still reads `pending` and refuses a replay.
   */
  withdrawn?: true;
}

type SubmissionState = "absent" | "pending" | "withdrawn" | "applied";
type SubmissionRequest = "admit" | "withdraw" | "apply";

export async function readMessageSubmission(
  stream: SessionEventStream<MessageSubmission>,
  id: string,
): Promise<MessageSubmission | undefined> {
  const seq = await stream.owner.lookupId("submission", id);
  if (seq === undefined || seq === AMBIGUOUS_ID) return undefined;
  return (await stream.read(seq, seq))[0]?.value;
}

/**
 * Caller holds the per-session lease through lookup and append. Pass `status: "pending"` to admit,
 * `status: "pending", withdrawn: true` to withdraw, and `status: "applied"` to confirm delivery.
 */
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
  const transition = resolveTransition(submissionState(previous), submissionRequest(input));
  if (transition === "keep" && previous) return { record: previous, created: false };
  // A re-admission keeps the original sender, time, and operation order of the first one.
  const { withdrawn: _withdrawn, ...base } = previous ?? input;
  const record: MessageSubmission = {
    ...base,
    status: input.status,
    ...(input.status === "pending" && input.withdrawn ? { withdrawn: true } : {}),
  };
  const seq = (await stream.state()).maxSeq + 1;
  await stream.append([
    { seq, value: record, ...(record.operation ? { operation: record.operation } : {}) },
  ]);
  return { record, created: transition === "admit" };
}

function submissionState(record: MessageSubmission | undefined): SubmissionState {
  if (!record) return "absent";
  if (record.status === "applied") return "applied";
  return record.withdrawn ? "withdrawn" : "pending";
}

function submissionRequest(input: MessageSubmission): SubmissionRequest {
  if (input.status === "applied") return "apply";
  return input.withdrawn ? "withdraw" : "admit";
}

/**
 * pending -> applied | withdrawn; withdrawn -> pending (admitted again). Applied is final, and a
 * second admission of an unresolved message keeps the first.
 */
function resolveTransition(
  current: SubmissionState,
  request: SubmissionRequest,
): "admit" | "resolve" | "keep" {
  if (current === "applied") return "keep";
  if (request === "admit") return current === "pending" ? "keep" : "admit";
  if (current === "pending") return "resolve";
  if (current === "withdrawn" && request === "withdraw") return "keep";
  throw new Error("Message was not durably admitted");
}

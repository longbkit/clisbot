import type { OutboxFailure } from "@/outbox/model";

export interface PendingMessageSubmission {
  clientMessageId: string;
  /** Set while the message waits for a Retry; the row stays where it was sent. */
  failure?: OutboxFailure;
}

export type MessageSubmissionRecord = PendingMessageSubmission & {
  providerAcknowledged: boolean;
  rpcSettled: boolean;
};

const EMPTY_MESSAGE_SUBMISSIONS: readonly MessageSubmissionRecord[] = [];

export function getActiveMessageSubmissions(
  submissions: readonly MessageSubmissionRecord[] | null | undefined,
): readonly PendingMessageSubmission[] {
  return (submissions ?? EMPTY_MESSAGE_SUBMISSIONS).filter(
    (submission) => !submission.providerAcknowledged,
  );
}

/** A failed message is not in flight: the agent must not look busy because of it. */
export function hasActiveMessageSubmission(
  submissions: readonly MessageSubmissionRecord[] | null | undefined,
): boolean {
  return (submissions ?? EMPTY_MESSAGE_SUBMISSIONS).some(
    (submission) => !submission.providerAcknowledged && !submission.failure,
  );
}

/** Rows a canonical replacement keeps: in flight or failed, never yet seen from the Host. */
export function getSendingClientMessageIds(
  submissions: readonly MessageSubmissionRecord[] | null | undefined,
): string[] {
  return (submissions ?? [])
    .filter((submission) => !submission.providerAcknowledged)
    .map((submission) => submission.clientMessageId);
}

export type MessageSubmissionRejectionOutcome = "rejected" | "accepted" | "unknown";

export interface MessageSubmissionRejectionResult {
  submissions: MessageSubmissionRecord[];
  outcome: MessageSubmissionRejectionOutcome;
}

export function beginMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  input: PendingMessageSubmission,
): MessageSubmissionRecord[] {
  if (submissions.some((submission) => submission.clientMessageId === input.clientMessageId)) {
    throw new Error(`Message submission already exists: ${input.clientMessageId}`);
  }
  return [...submissions, { ...input, providerAcknowledged: false, rpcSettled: false }];
}

export function acceptMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageId: string,
): MessageSubmissionRecord[] {
  const index = submissions.findIndex(
    (submission) => submission.clientMessageId === clientMessageId,
  );
  if (index < 0) return submissions as MessageSubmissionRecord[];
  const submission = submissions[index];
  if (submission.providerAcknowledged) {
    return submissions.filter((_, submissionIndex) => submissionIndex !== index);
  }
  if (submission.rpcSettled) return submissions as MessageSubmissionRecord[];
  return submissions.map((item, submissionIndex) =>
    submissionIndex === index ? { ...item, rpcSettled: true } : item,
  );
}

function upsertSubmission(
  submissions: readonly MessageSubmissionRecord[],
  record: MessageSubmissionRecord,
): MessageSubmissionRecord[] {
  const index = submissions.findIndex((item) => item.clientMessageId === record.clientMessageId);
  if (index < 0) return [...submissions, record];
  return submissions.map((item, itemIndex) => (itemIndex === index ? record : item));
}

/** Keeps the row and records why it is not sent; also adopts a row an old Host left untracked. */
export function failMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageId: string,
  failure: OutboxFailure,
): MessageSubmissionRecord[] {
  return upsertSubmission(submissions, {
    clientMessageId,
    failure,
    providerAcknowledged: false,
    rpcSettled: false,
  });
}

/** A retry is a fresh attempt of the same message id. */
export function retryMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageId: string,
): MessageSubmissionRecord[] {
  return upsertSubmission(submissions, {
    clientMessageId,
    providerAcknowledged: false,
    rpcSettled: false,
  });
}

export function discardMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageId: string,
): MessageSubmissionRecord[] {
  const next = submissions.filter((item) => item.clientMessageId !== clientMessageId);
  return next.length === submissions.length ? (submissions as MessageSubmissionRecord[]) : next;
}

export function observeMessageSubmissionCanonical(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageIds: readonly string[],
): MessageSubmissionRecord[] {
  if (clientMessageIds.length === 0) return submissions as MessageSubmissionRecord[];
  const observed = new Set(clientMessageIds);
  let changed = false;
  const next = submissions.flatMap((submission): MessageSubmissionRecord[] => {
    if (submission.providerAcknowledged || !observed.has(submission.clientMessageId)) {
      return [submission];
    }
    changed = true;
    // A failed message the Host shows after all was delivered: the failure is stale.
    if (submission.rpcSettled || submission.failure) return [];
    return [{ ...submission, providerAcknowledged: true }];
  });
  return changed ? next : (submissions as MessageSubmissionRecord[]);
}

export function rejectMessageSubmission(
  submissions: readonly MessageSubmissionRecord[],
  clientMessageId: string,
): MessageSubmissionRejectionResult {
  const submission = submissions.find((item) => item.clientMessageId === clientMessageId);
  if (!submission) {
    return { outcome: "unknown", submissions: submissions as MessageSubmissionRecord[] };
  }
  return {
    outcome: submission.providerAcknowledged ? "accepted" : "rejected",
    submissions: submissions.filter((item) => item.clientMessageId !== clientMessageId),
  };
}

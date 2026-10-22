import { promises as fs } from "node:fs";
import path from "node:path";
import { syncDirectory } from "../agent/session-storage/durable-file.js";

import {
  assertSessionNotDeleted,
  writeSessionDeletionIntent,
} from "../agent/session-storage/deletion-intents.js";

export const SESSION_FILE_LIMITS = {
  operationBytes: 16 * 1024 * 1024,
  globalBytes: 64 * 1024 * 1024,
  sessionOperations: 64,
  globalOperations: 512,
  sessionUploads: 16,
  globalUploads: 256,
} as const;
/** Refused before capture, writes or provider admission; safe to retry the same input. */
export class SessionFileAdmissionBusyError extends Error {
  constructor() {
    super("The Host is busy saving attachments. Please try sending again in a moment.");
  }
}

let retryWaiters = 0;
/** At most one refused, already size-validated input waits (<=16 MiB reservation).
 * This is not a queue: further contenders fail promptly and retain their client drafts.
 */
export async function retrySessionFileAdmission<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [50, 150, 350];
  let waiting = false;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof SessionFileAdmissionBusyError) || attempt >= delays.length)
          throw error;
        if (!waiting && retryWaiters) throw error;
        if (!waiting) {
          retryWaiters += 1;
          waiting = true;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  } finally {
    if (waiting) retryWaiters -= 1;
  }
}

interface Activity {
  deleting: boolean;
  operations: Set<Promise<unknown>>;
  tail: Promise<unknown>;
  uploads: Set<() => Promise<void>>;
  bytes: number;
}
const activities = new Map<string, Activity>();
let operationCount = 0;
let uploadCount = 0;
let retainedBytes = 0;
function state(directory: string): Activity {
  let current = activities.get(directory);
  if (!current) {
    if (activities.size >= SESSION_FILE_LIMITS.globalOperations)
      throw new Error("Session file storage overloaded: owner budget exceeded");
    current = {
      deleting: false,
      operations: new Set(),
      tail: Promise.resolve(),
      uploads: new Set(),
      bytes: 0,
    };
    activities.set(directory, current);
  }
  return current;
}
function releaseIdle(directory: string, current: Activity): void {
  if (!current.deleting && !current.operations.size && !current.uploads.size)
    activities.delete(directory);
}
/** Holds immutable source files against deletion without serializing cross-session fork locks. */
export async function withSessionFileLease<T>(
  directory: string,
  operation: () => Promise<T>,
  bytes = 4096,
): Promise<T> {
  return admit(directory, operation, bytes, false);
}
export async function withSessionFileOperation<T>(
  directory: string,
  operation: () => Promise<T>,
  bytes = 4096,
  capture?: () => void,
): Promise<T> {
  return admit(directory, operation, bytes, true, capture);
}
function admit<T>(
  directory: string,
  operation: () => Promise<T>,
  bytes: number,
  serial: boolean,
  capture?: () => void,
): Promise<T> {
  const current = state(directory);
  if (current.deleting) return Promise.reject(new Error("Agent is being deleted"));
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > SESSION_FILE_LIMITS.operationBytes) {
    releaseIdle(directory, current);
    return Promise.reject(new Error("Session file storage overloaded: operation budget exceeded"));
  }
  if (
    current.bytes + bytes > SESSION_FILE_LIMITS.operationBytes ||
    retainedBytes + bytes > SESSION_FILE_LIMITS.globalBytes ||
    current.operations.size >= SESSION_FILE_LIMITS.sessionOperations ||
    operationCount >= SESSION_FILE_LIMITS.globalOperations
  ) {
    releaseIdle(directory, current);
    return Promise.reject(new SessionFileAdmissionBusyError());
  }
  retainedBytes += bytes;
  current.bytes += bytes;
  operationCount += 1;
  try {
    capture?.();
  } catch (error) {
    retainedBytes -= bytes;
    current.bytes -= bytes;
    operationCount -= 1;
    releaseIdle(directory, current);
    return Promise.reject(error);
  }
  const pending = (serial ? current.tail.catch(() => undefined) : Promise.resolve()).then(
    async () => {
      await assertSessionNotDeleted(directory);
      try {
        return await operation();
      } catch (error) {
        // A nested owner can refuse after this operation has already written.
        // Do not expose that as a retryable refusal of this operation.
        if (error instanceof SessionFileAdmissionBusyError)
          throw new Error(error.message, { cause: error });
        throw error;
      }
    },
  );
  if (serial) current.tail = pending;
  current.operations.add(pending);
  return pending.finally(() => {
    retainedBytes -= bytes;
    current.bytes -= bytes;
    operationCount -= 1;
    current.operations.delete(pending);
    releaseIdle(directory, current);
  });
}
export async function registerSessionUpload(
  directory: string,
  cancel: () => Promise<void>,
): Promise<() => void> {
  const current = state(directory);
  if (current.deleting) throw new Error("Agent is being deleted");
  if (
    current.uploads.size >= SESSION_FILE_LIMITS.sessionUploads ||
    uploadCount >= SESSION_FILE_LIMITS.globalUploads
  ) {
    releaseIdle(directory, current);
    throw new Error("Session file storage overloaded: upload budget exceeded");
  }
  const cancellation = () => cancel();
  current.uploads.add(cancellation);
  uploadCount += 1;
  const release = () => {
    if (current.uploads.delete(cancellation)) uploadCount -= 1;
    releaseIdle(directory, current);
  };
  try {
    await assertSessionNotDeleted(directory);
  } catch (error) {
    release();
    throw error;
  }
  return release;
}
export function hasSessionUploads(directory: string): boolean {
  return Boolean(activities.get(directory)?.uploads.size);
}
/** New admissions close synchronously; accepted source leases and writes drain before deletion. */
export async function beginSessionFileDelete(directory: string): Promise<void> {
  const current = state(directory);
  current.deleting = true;
  const cancellations = await Promise.allSettled(
    [...current.uploads].map((cancel) => Promise.resolve().then(cancel)),
  );
  await Promise.allSettled(current.operations);
  const failure = cancellations.find((result) => result.status === "rejected");
  // A cancellation can reject after its upload unregisters. Do not strand an
  // otherwise idle owner in the deleting state; callers may retry deletion.
  if (failure && !current.operations.size && !current.uploads.size) {
    current.deleting = false;
    releaseIdle(directory, current);
  }
  if (failure?.status === "rejected") throw failure.reason;
}
export async function deleteSessionDirectory(directory: string): Promise<void> {
  await beginSessionFileDelete(directory);
  // The durable fence outlives process-local owners and prevents stale requests resurrecting files.
  try {
    await writeSessionDeletionIntent(directory);
    await fs.rm(directory, { recursive: true, force: true });
    await syncDirectory(path.dirname(directory));
  } finally {
    activities.delete(directory);
  }
}
export function sessionFileActivityUsage() {
  return {
    owners: activities.size,
    operations: operationCount,
    uploads: uploadCount,
    retainedBytes,
    retryRetainedBytes: retryWaiters * SESSION_FILE_LIMITS.operationBytes,
  };
}

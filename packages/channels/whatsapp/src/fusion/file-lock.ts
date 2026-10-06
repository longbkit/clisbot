// Fusion-owned `plugin-sdk/file-lock` for `connection-owner.ts` (D-WA-014).
//
// Upstream serializes Baileys sockets for one auth directory ACROSS processes
// with a PID-stamped lock file beside the auth dir. In Fusion one Hub process
// owns an account (the supervisor starts it once), and the auth directory is
// not on disk (`fusion/auth-fs.ts`), so there is no file to lock. The in-process
// half of upstream's owner lease — `reserveProcessOwner` in the ported
// `connection-owner.ts` — still runs and still refuses a second socket for the
// same account; only the cross-process lock below it is a no-op lease.
export const FILE_LOCK_STALE_ERROR_CODE = "file_lock_stale";
export const FILE_LOCK_TIMEOUT_ERROR_CODE = "file_lock_timeout";

export type FileLockHandle = { release: () => Promise<void> };

export async function acquireFileLock(_target: string, _options?: unknown): Promise<FileLockHandle> {
  return { release: async () => {} };
}

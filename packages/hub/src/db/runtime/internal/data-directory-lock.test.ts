import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireDataDirectoryLock } from "./data-directory-lock.js";

const LOCK_FILE_NAME = ".paseo-hub.lock";

function esrchError(): NodeJS.ErrnoException {
  const error = new Error("kill (4242) ESRCH: no such process") as NodeJS.ErrnoException;
  error.code = "ESRCH";
  return error;
}

/** The kill probe passes for `pid` (the task still exists in the kernel); the
 * /proc status read serves `status` (or throws when null, as a vanished task
 * would). Everything else reads through to the real fs. */
function kernelSees(pid: number, status: string | null): void {
  const original = fs.readFileSync as (pidPath: unknown, ...rest: unknown[]) => unknown;
  vi.spyOn(process, "kill").mockImplementation((pidArg: number): true => {
    if (pidArg === pid) return true;
    throw esrchError();
  });
  vi.spyOn(fs, "readFileSync").mockImplementation(((pidPath: unknown, ...rest: unknown[]) => {
    if (String(pidPath) === `/proc/${pid}/status`) {
      if (status === null) throw new Error("ENOENT: no such file");
      return status;
    }
    return original(pidPath, ...rest);
  }) as unknown as typeof fs.readFileSync);
}

const tempRoots: string[] = [];

async function createDataDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hub-data-dir-lock-"));
  tempRoots.push(root);
  return root;
}

function writeLock(dataDirectory: string, pid: number, token: string): void {
  fs.writeFileSync(path.join(dataDirectory, LOCK_FILE_NAME), JSON.stringify({ pid, token }), {
    mode: 0o600,
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("acquireDataDirectoryLock", () => {
  it("acquires a free directory and releases the lock", async () => {
    const dir = await createDataDirectory();
    const lock = await acquireDataDirectoryLock(dir);
    expect(fs.existsSync(path.join(dir, LOCK_FILE_NAME))).toBe(true);
    await lock.release();
    expect(fs.existsSync(path.join(dir, LOCK_FILE_NAME))).toBe(false);
  });

  it("refuses a directory locked by a live owner", async () => {
    const dir = await createDataDirectory();
    writeLock(dir, 4242, "owner-token");
    kernelSees(4242, "State:\tS (sleeping)\n");

    await expect(acquireDataDirectoryLock(dir)).rejects.toThrow(/already in use/);
    // The live owner's lock record is untouched.
    expect(fs.existsSync(path.join(dir, LOCK_FILE_NAME))).toBe(true);
  });

  it("recovers a lock owned by a zombie (kill(0) passes but the task is exited)", async () => {
    // The live failure: a hub SIGKILL'd under a non-reaping init. Its task
    // stays a zombie forever, so the probe-only liveness check reported the
    // stale owner "running" and the next start refused its own data
    // directory. The /proc state check must take the stale lock instead.
    const dir = await createDataDirectory();
    writeLock(dir, 4242, "owner-token");
    kernelSees(4242, "State:\tZ (zombie)\nSigBlk:\t0000000000000000\n");

    const lock = await acquireDataDirectoryLock(dir);
    const record = JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILE_NAME), "utf8")) as {
      pid: number;
    };
    expect(record.pid).toBe(process.pid);
    await lock.release();
  });

  it("recovers a lock whose owner is gone entirely", async () => {
    const dir = await createDataDirectory();
    writeLock(dir, 4242, "owner-token");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw esrchError();
    });

    const lock = await acquireDataDirectoryLock(dir);
    await lock.release();
  });
});

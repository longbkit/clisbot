import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { readDaemonInstance, stopDaemonInstance } from "./daemon-instance.js";
import { acquirePidLock, getPidLockInfo, isLocked, type PidLockInfo } from "./pid-lock.js";

// A process cannot have started before the machine booted, so a lock stamped
// before this boot names a PID that some unrelated process now holds.
function bootedAt(): number {
  return Date.now() - uptime() * 1000;
}

async function writeLock(clisbotHome: string, lock: PidLockInfo): Promise<void> {
  await writeFile(join(clisbotHome, "clisbot.pid"), JSON.stringify(lock));
}

function lockFor(pid: number, startedAt: Date): PidLockInfo {
  return {
    pid,
    startedAt: startedAt.toISOString(),
    hostname: "old-host",
    uid: process.getuid?.() ?? 0,
    listen: "127.0.0.1:6868",
    desktopManaged: true,
    heartbeat: true,
  };
}

describe("daemon instance identity across a reboot", () => {
  let clisbotHome: string;
  let bystander: ChildProcess | undefined;

  beforeEach(async () => {
    clisbotHome = await mkdtemp(join(tmpdir(), "clisbot-daemon-instance-"));
  });

  afterEach(async () => {
    bystander?.kill("SIGKILL");
    bystander = undefined;
    await rm(clisbotHome, { recursive: true, force: true });
  });

  test("a lock stamped before this boot has no running owner", async () => {
    await writeLock(clisbotHome, lockFor(process.pid, new Date(bootedAt() - 60 * 60_000)));

    expect(await readDaemonInstance(clisbotHome)).toBeNull();
    expect(await isLocked(clisbotHome)).toMatchObject({ locked: false });
  });

  test("a supervisor started during this boot still holds the lock", async () => {
    await writeLock(clisbotHome, lockFor(process.pid, new Date()));

    expect(await readDaemonInstance(clisbotHome)).toMatchObject({ pid: process.pid });
    expect(await isLocked(clisbotHome)).toMatchObject({ locked: true });
  });

  test("a new supervisor takes over a lock stamped before this boot", async () => {
    await writeLock(clisbotHome, lockFor(process.pid, new Date(bootedAt() - 60 * 60_000)));

    await acquirePidLock(clisbotHome, null, { ownerPid: process.pid + 10_000 });

    expect(await getPidLockInfo(clisbotHome)).toMatchObject({ pid: process.pid + 10_000 });
  });

  test("stopping a lock stamped before this boot leaves the process holding that pid alone", async () => {
    // Records delivery rather than dying of it, so a signal cannot be missed by arriving late.
    const signalMarker = join(clisbotHome, "bystander-signalled");
    bystander = spawn(
      process.execPath,
      [
        "-e",
        `process.on("SIGTERM", () => require("node:fs").writeFileSync(${JSON.stringify(signalMarker)}, "SIGTERM"));` +
          `setTimeout(() => {}, 120_000);`,
      ],
      { stdio: "ignore" },
    );
    const bystanderPid = bystander.pid;
    if (bystanderPid === undefined) throw new Error("bystander process did not start");
    let exited = false;
    bystander.once("exit", () => {
      exited = true;
    });

    await writeLock(clisbotHome, lockFor(bystanderPid, new Date(bootedAt() - 60 * 60_000)));

    expect(await stopDaemonInstance(clisbotHome)).toMatchObject({ action: "not_running" });

    expect(existsSync(signalMarker)).toBe(false);
    expect(exited).toBe(false);
    await expect(readFile(join(clisbotHome, "clisbot.pid"), "utf-8")).rejects.toThrow(/ENOENT/);
  });
});

// Linux keeps a boot's id while a VM is paused for a host sleep, though the VM's wall clock
// runs ahead of its uptime once it resumes. A sleep longer than the time between boot and
// the supervisor's start puts the wall-clock boot instant after the lock's startedAt.
describe.runIf(process.platform === "linux")("daemon instance identity on Linux", () => {
  let clisbotHome: string;

  beforeEach(async () => {
    clisbotHome = await mkdtemp(join(tmpdir(), "clisbot-daemon-instance-linux-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(clisbotHome, { recursive: true, force: true });
  });

  test("a supervisor still holds the lock after its paused VM resumes", async () => {
    await acquirePidLock(clisbotHome, null, { ownerPid: process.pid });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + uptime() * 1000 + 12 * 60 * 60_000);

    expect(await readDaemonInstance(clisbotHome)).toMatchObject({ pid: process.pid });
    expect(await isLocked(clisbotHome)).toMatchObject({ locked: true });
    await expect(
      acquirePidLock(clisbotHome, null, { ownerPid: process.pid + 10_000 }),
    ).rejects.toThrow("Another Clisbot daemon is already running");
  });

  test("a lock written during another boot has no running owner", async () => {
    await writeLock(clisbotHome, {
      ...lockFor(process.pid, new Date()),
      bootId: "00000000-0000-0000-0000-000000000000",
    });

    expect(await readDaemonInstance(clisbotHome)).toBeNull();
    expect(await isLocked(clisbotHome)).toMatchObject({ locked: false });
  });
});

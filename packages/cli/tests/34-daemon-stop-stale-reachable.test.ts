#!/usr/bin/env npx tsx

/**
 * Regression: `clisbot daemon stop` must leave a reachable daemon alone when the
 * selected home points at a dead supervisor owner.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { connectToDaemon } from "../src/utils/client.js";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const pollIntervalMs = 100;
const testEnv = {
  CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  CLISBOT_DICTATION_ENABLED: process.env.CLISBOT_DICTATION_ENABLED ?? "0",
  CLISBOT_VOICE_MODE_ENABLED: process.env.CLISBOT_VOICE_MODE_ENABLED ?? "0",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(pollIntervalMs);
    return poll();
  }

  return poll();
}

interface DaemonStatus {
  localDaemon: string | null;
  connectedDaemon: string | null;
  pid: number | null;
}

async function readDaemonStatus(clisbotHome: string): Promise<DaemonStatus> {
  const result =
    await $`CLISBOT_HOME=${clisbotHome} CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD} CLISBOT_DICTATION_ENABLED=${testEnv.CLISBOT_DICTATION_ENABLED} CLISBOT_VOICE_MODE_ENABLED=${testEnv.CLISBOT_VOICE_MODE_ENABLED} npx clisbot daemon status --home ${clisbotHome} --json`.nothrow();
  if (result.exitCode !== 0) {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      localDaemon?: unknown;
      connectedDaemon?: unknown;
      pid?: unknown;
    };
    return {
      localDaemon: typeof parsed.localDaemon === "string" ? parsed.localDaemon : null,
      connectedDaemon: typeof parsed.connectedDaemon === "string" ? parsed.connectedDaemon : null,
      pid:
        typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
          ? parsed.pid
          : null,
    };
  } catch {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }
}

function findUnusedPid(): number {
  for (let pid = 999_999; pid > 900_000; pid--) {
    if (!isProcessRunning(pid)) {
      return pid;
    }
  }
  throw new Error("Unable to find unused pid for stale pid fixture");
}

console.log("=== Daemon Stop (stale pid, reachable worker regression) ===\n");

const port = await getAvailablePort();
const clisbotHome = await mkdtemp(join(tmpdir(), "clisbot-stop-stale-reachable-"));
const cliRoot = join(import.meta.dirname, "..");
const host = `127.0.0.1:${port}`;
const pidPath = join(clisbotHome, "clisbot.pid");
const stalePid = findUnusedPid();

let workerProcess: ChildProcess | null = null;

try {
  console.log("Test 1: start daemon worker with stale supervisor pid file");

  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        pid: stalePid,
        startedAt: new Date().toISOString(),
        hostname: "stale-supervisor-fixture.local",
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        listen: host,
      },
      null,
      2,
    )}\n`,
  );

  workerProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../server/src/server/daemon-worker.ts"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        CLISBOT_HOME: clisbotHome,
        CLISBOT_LISTEN: host,
        CLISBOT_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitFor(
    async () => {
      try {
        const client = await connectToDaemon({ target: { kind: "endpoint", host }, timeout: 500 });
        await client.close();
        return true;
      } catch {
        return false;
      }
    },
    120000,
    "unowned worker did not become reachable in time",
  );

  const statusBeforeStop = await readDaemonStatus(clisbotHome);
  assert.strictEqual(statusBeforeStop.pid, null, "status should not claim a dead owner is running");
  assert(workerProcess.pid && isProcessRunning(workerProcess.pid), "worker should be running");
  console.log(`✓ fixture has stale pid ${stalePid} and live worker ${workerProcess.pid}\n`);

  console.log("Test 2: home-selected stop leaves the unowned reachable worker running");
  const stopResult =
    await $`CLISBOT_HOME=${clisbotHome} CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD} CLISBOT_DICTATION_ENABLED=${testEnv.CLISBOT_DICTATION_ENABLED} CLISBOT_VOICE_MODE_ENABLED=${testEnv.CLISBOT_VOICE_MODE_ENABLED} npx clisbot daemon stop --home ${clisbotHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  const stopJson = JSON.parse(stopResult.stdout) as {
    action?: unknown;
    pid?: unknown;
    message?: unknown;
  };
  assert.strictEqual(stopJson.action, "not_running");
  assert.strictEqual(stopJson.pid, stalePid);
  assert(
    workerProcess.pid && isProcessRunning(workerProcess.pid),
    "stop must not contact the stale endpoint",
  );
  assert.strictEqual(existsSync(pidPath), false, "stale pid file should be removed after stop");
  console.log("✓ stop recovered stale supervisor pid state\n");
} finally {
  if (workerProcess?.pid && isProcessRunning(workerProcess.pid)) {
    workerProcess.kill("SIGTERM");
    await waitFor(
      () => !isProcessRunning(workerProcess!.pid ?? -1),
      5000,
      "worker cleanup timed out",
    ).catch(() => {
      workerProcess?.kill("SIGKILL");
    });
  }

  await $`CLISBOT_HOME=${clisbotHome} CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD} CLISBOT_DICTATION_ENABLED=${testEnv.CLISBOT_DICTATION_ENABLED} CLISBOT_VOICE_MODE_ENABLED=${testEnv.CLISBOT_VOICE_MODE_ENABLED} npx clisbot daemon stop --home ${clisbotHome} --force`.nothrow();
  await rm(clisbotHome, { recursive: true, force: true });
}

console.log("=== Stale reachable stop regression test passed ===");

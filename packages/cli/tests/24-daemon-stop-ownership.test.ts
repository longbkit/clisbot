#!/usr/bin/env npx tsx

/**
 * Regression: `clisbot daemon stop` must only act on daemon ownership state and
 * must not discover/kill processes via home-scoped `ps` command heuristics.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";

$.verbose = false;

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

async function waitForRunning(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<void> {
    if (isProcessRunning(pid)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Process ${pid} did not become running in time`);
    }
    await sleep(50);
    return poll();
  }
  return poll();
}

console.log("=== Daemon Stop Ownership Regression ===\n");

const clisbotHome = await mkdtemp(join(tmpdir(), "clisbot-stop-ownership-"));
let decoyProcess: ChildProcess | null = null;

try {
  console.log("Test 1: start decoy process with daemon-like command markers");

  decoyProcess = spawn(
    process.execPath,
    [
      "-e",
      // Keep the process alive long enough for stop command assertions.
      "setInterval(() => {}, 1000)",
      "supervisor-entrypoint.ts",
    ],
    {
      env: {
        ...process.env,
        CLISBOT_HOME: clisbotHome,
      },
      stdio: "ignore",
      detached: process.platform !== "win32",
    },
  );
  decoyProcess.unref();

  const decoyPid = decoyProcess.pid;
  assert(Number.isInteger(decoyPid) && (decoyPid ?? 0) > 0, "decoy pid should exist");
  await waitForRunning(decoyPid!, 5000);
  console.log(`✓ decoy process started (${decoyPid})\n`);

  console.log("Test 2: daemon stop should report not_running and leave decoy untouched");

  const stopResult =
    await $`CLISBOT_HOME=${clisbotHome} CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.CLISBOT_LOCAL_SPEECH_AUTO_DOWNLOAD} CLISBOT_DICTATION_ENABLED=${testEnv.CLISBOT_DICTATION_ENABLED} CLISBOT_VOICE_MODE_ENABLED=${testEnv.CLISBOT_VOICE_MODE_ENABLED} npx clisbot daemon stop --home ${clisbotHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);

  const parsed = JSON.parse(stopResult.stdout) as { action?: unknown };
  assert.strictEqual(
    parsed.action,
    "not_running",
    `stop should not target decoy process: ${stopResult.stdout}`,
  );
  assert(isProcessRunning(decoyPid!), "decoy process must remain alive after stop");

  console.log("✓ stop is ownership-driven and does not kill decoy process\n");
} finally {
  if (decoyProcess?.pid && isProcessRunning(decoyProcess.pid)) {
    try {
      process.kill(decoyProcess.pid, "SIGTERM");
    } catch {
      // ignore
    }
    await sleep(100);
    if (isProcessRunning(decoyProcess.pid)) {
      try {
        process.kill(decoyProcess.pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  await $`CLISBOT_HOME=${clisbotHome} npx clisbot daemon stop --home ${clisbotHome} --force`.nothrow();
  await rm(clisbotHome, { recursive: true, force: true });
}

console.log("=== Daemon stop ownership regression test passed ===");

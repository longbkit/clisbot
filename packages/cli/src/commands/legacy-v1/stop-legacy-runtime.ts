import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { record } from "./legacy-config.js";

function legacyPids(home: string): number[] {
  const pidFile = path.join(home, "state", "clisbot.pid");
  const stateFile = path.join(home, "state", "clisbot-monitor.json");
  const values: unknown[] = [];
  if (existsSync(pidFile)) values.push(Number(readFileSync(pidFile, "utf8").trim()));
  if (existsSync(stateFile)) {
    const state = record(JSON.parse(readFileSync(stateFile, "utf8")));
    values.push(state.monitorPid, state.runtimePid);
  }
  return [
    ...new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isSafeInteger(value) && value > 1,
      ),
    ),
  ];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform !== "win32") {
      const state = execFileSync("ps", ["-p", String(pid), "-o", "stat="], {
        encoding: "utf8",
      });
      if (state.trim().startsWith("Z")) return false;
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if (typeof (error as { status?: number }).status === "number") return false;
    throw error;
  }
}

function verifyLegacyPid(pid: number, home: string): void {
  if (process.platform === "win32")
    throw new Error("Stop v1 before upgrading this home on Windows.");
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  const entry = /[/\\]clisbot[^/\\]*[/\\](?:dist[/\\]main\.js|src[/\\]main\.ts)\b/u;
  if (!entry.test(command) || !/\bserve-(?:monitor|foreground)\b/u.test(command)) {
    throw new Error(
      `Cannot verify v1 PID ${pid}; stop the old service manually, then rerun onboard. No unrelated process was stopped.`,
    );
  }
  const config = path.join(home, "clisbot.json");
  const environment =
    process.platform === "linux"
      ? readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")
      : execFileSync("ps", ["eww", "-p", String(pid), "-o", "command="], {
          encoding: "utf8",
        }).split(/\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/u);
  if (!environment.some((value) => value.trim() === `CLISBOT_CONFIG_PATH=${config}`)) {
    throw new Error(
      `Cannot prove v1 PID ${pid} belongs to this home; stop the old service manually.`,
    );
  }
}

/** Stop the monitor first, so it cannot respawn the worker during handover. */
export async function stopLegacyRuntime(
  home: string,
  beforeStop?: () => void,
  onStopped?: (pid: number) => void,
): Promise<number[]> {
  const pids = legacyPids(home).filter(isAlive);
  for (const pid of pids) verifyLegacyPid(pid, home);
  if (pids.length > 0) beforeStop?.();
  for (const pid of pids) {
    if (!isAlive(pid)) continue;
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 10_000;
    while (isAlive(pid) && Date.now() < deadline) await delay(100);
    if (isAlive(pid)) throw new Error(`v1 PID ${pid} did not stop; v2 was not started.`);
    onStopped?.(pid);
  }
  return pids;
}

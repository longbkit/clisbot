import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export interface LaunchdResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type LaunchdRunner = (file: string, args: string[]) => Promise<LaunchdResult>;

export interface LaunchdJobState {
  loaded: boolean;
  pid: number | null;
  lastExitStatus: number | null;
}

export interface Launchd {
  domain: string;
  agentsDirectory: string;
  plistPath(label: string): string;
  bootstrap(plistPath: string): Promise<LaunchdResult>;
  bootout(label: string): Promise<LaunchdResult>;
  readJob(label: string): Promise<LaunchdJobState>;
}

const LAUNCHCTL_TIMEOUT_MS = 15_000;

const execFileAsync = promisify(execFile);

export const execFileRunner: LaunchdRunner = async (file, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: LAUNCHCTL_TIMEOUT_MS,
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      status: typeof failure.code === "number" ? failure.code : null,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
};

/** `launchctl list <label>` prints a job dictionary; a non-zero exit means the
 * label is not loaded at all. */
export function parseLaunchdJobState(stdout: string): LaunchdJobState {
  const pid = /"PID"\s*=\s*(\d+)/.exec(stdout);
  const exitStatus = /"LastExitStatus"\s*=\s*(-?\d+)/.exec(stdout);
  return {
    loaded: true,
    pid: pid === null ? null : Number(pid[1]),
    lastExitStatus: exitStatus === null ? null : Number(exitStatus[1]),
  };
}

export function createLaunchd(input: {
  userHome: string;
  uid: number;
  run?: LaunchdRunner;
}): Launchd {
  const run = input.run ?? execFileRunner;
  const domain = `gui/${input.uid}`;
  const agentsDirectory = path.join(input.userHome, "Library", "LaunchAgents");
  return {
    domain,
    agentsDirectory,
    plistPath: (label) => path.join(agentsDirectory, `${label}.plist`),
    bootstrap: (plist) => run("launchctl", ["bootstrap", domain, plist]),
    bootout: (label) => run("launchctl", ["bootout", `${domain}/${label}`]),
    readJob: async (label) => {
      const result = await run("launchctl", ["list", label]);
      if (result.status !== 0) return { loaded: false, pid: null, lastExitStatus: null };
      return parseLaunchdJobState(result.stdout);
    },
  };
}

export function describeLaunchdFailure(result: LaunchdResult, action: string): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  if (detail.length > 0) return detail;
  return `launchctl ${action} exited with status ${result.status === null ? "unknown" : result.status}`;
}

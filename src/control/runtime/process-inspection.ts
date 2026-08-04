import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { kill } from "node:process";

export type ProcessLiveness = "running" | "zombie" | "missing";
export type RuntimeProcessRole = "serve-monitor" | "serve-foreground";

type ProcessLivenessDependencies = {
  platform: NodeJS.Platform;
  signalCheck: (pid: number) => boolean;
  readLinuxProcStat: (pid: number) => ProcessLiveness | "unknown";
  readPsStat: (pid: number) => ProcessLiveness | "unknown";
};

type ProcessMetadata = {
  command: string;
  startedAtMs: number;
};

const PROCESS_START_TOLERANCE_MS = 10_000;
const DEFAULT_PROCESS_LIVENESS_DEPENDENCIES: ProcessLivenessDependencies = {
  platform: process.platform,
  signalCheck: signalCheckProcess,
  readLinuxProcStat: readLinuxProcStatLiveness,
  readPsStat: readPsStatLiveness,
};

export function getProcessLiveness(
  pid: number,
  dependencies: Partial<ProcessLivenessDependencies> = {},
): ProcessLiveness {
  const resolvedDependencies = {
    ...DEFAULT_PROCESS_LIVENESS_DEPENDENCIES,
    ...dependencies,
  } satisfies ProcessLivenessDependencies;

  if (!resolvedDependencies.signalCheck(pid)) {
    return "missing";
  }
  if (resolvedDependencies.platform === "win32") {
    return "running";
  }

  const linuxState = resolvedDependencies.readLinuxProcStat(pid);
  if (linuxState !== "unknown") {
    return linuxState;
  }

  const psState = resolvedDependencies.readPsStat(pid);
  return psState === "unknown" ? "running" : psState;
}

export function processMatchesRuntimeRole(
  params: {
    pid: number;
    expectedStartedAt?: string;
    role: RuntimeProcessRole;
  },
  dependencies: {
    processLiveness?: (pid: number) => ProcessLiveness;
    readProcessMetadata?: (pid: number) => ProcessMetadata | null;
  } = {},
) {
  const processLiveness = dependencies.processLiveness ?? getProcessLiveness;
  if (processLiveness(params.pid) !== "running") {
    return false;
  }

  const metadata = (dependencies.readProcessMetadata ?? readProcessMetadata)(params.pid);
  if (!metadata || !commandHasRole(metadata.command, params.role)) {
    return false;
  }
  if (!params.expectedStartedAt) {
    return true;
  }
  const expectedStartedAtMs = Date.parse(params.expectedStartedAt);
  return Number.isFinite(expectedStartedAtMs)
    && Math.abs(metadata.startedAtMs - expectedStartedAtMs) <= PROCESS_START_TOLERANCE_MS;
}

function readProcessMetadata(pid: number): ProcessMetadata | null {
  try {
    const raw = execFileSync(
      "ps",
      ["-ww", "-o", "lstart=", "-o", "args=", "-p", String(pid)],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const match = raw.match(/^(.{24})\s+(.+)$/s);
    if (!match) {
      return null;
    }
    const startedAtMs = Date.parse(match[1]);
    if (!Number.isFinite(startedAtMs)) {
      return null;
    }
    return { startedAtMs, command: match[2].trim() };
  } catch {
    return null;
  }
}

function commandHasRole(command: string, role: RuntimeProcessRole) {
  return command.split(/\s+/).includes(role);
}

function signalCheckProcess(pid: number) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLinuxProcStatLiveness(pid: number): ProcessLiveness | "unknown" {
  if (process.platform !== "linux") {
    return "unknown";
  }

  try {
    const state = extractLinuxProcState(readFileSync(`/proc/${pid}/stat`, "utf8"));
    return state ? (state.includes("Z") ? "zombie" : "running") : "unknown";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unknown";
  }
}

function readPsStatLiveness(pid: number): ProcessLiveness | "unknown" {
  try {
    const raw = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return raw ? (raw.includes("Z") ? "zombie" : "running") : "missing";
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { status?: number | null };
    if (commandError.code === "ENOENT") {
      return "unknown";
    }
    return commandError.status === 1 ? "missing" : "unknown";
  }
}

function extractLinuxProcState(raw: string) {
  const closingParenIndex = raw.lastIndexOf(")");
  const remainder = closingParenIndex < 0 ? "" : raw.slice(closingParenIndex + 1).trim();
  return remainder ? remainder.split(/\s+/, 1)[0]?.trim() || null : null;
}

import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureDir, fileExists, readTextFile } from "../../infra/fs.ts";

export type RunnerExitRecord = {
  sessionName: string;
  exitCode: number;
  command: string;
  exitedAt: string;
};

// After a nonzero runner exit the wrapper prints this sentinel and keeps the
// pane alive briefly, so clisbot can read the runner's final error output and
// classify the failure (resume rejected, state-db locked, state-db corrupted)
// instead of only seeing that the tmux session disappeared.
export const RUNNER_EXIT_SENTINEL_PREFIX = "[clisbot] runner exited with status";
export const RUNNER_EXIT_LINGER_SECONDS = 8;

export function paneShowsRunnerExitSentinel(snapshot: string) {
  return snapshot.includes(RUNNER_EXIT_SENTINEL_PREFIX);
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildCommandString(command: string, args: string[]) {
  return [command, ...args].map(shellQuote).join(" ");
}

function sanitizeSessionName(sessionName: string) {
  return sessionName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function getRunnerExitRecordPath(stateDir: string, sessionName: string) {
  return join(stateDir, "runner-exits", `${sanitizeSessionName(sessionName)}.json`);
}

export function buildRunnerLaunchCommand(params: {
  command: string;
  args: string[];
  wrapperDir: string;
  wrapperPath: string;
  sessionName: string;
  stateDir: string;
  exitLingerSeconds?: number;
}) {
  const exitLingerSeconds = params.exitLingerSeconds ?? RUNNER_EXIT_LINGER_SECONDS;
  const runnerCommand = buildCommandString(params.command, params.args);
  const exitRecordPath = getRunnerExitRecordPath(params.stateDir, params.sessionName);
  const exitWriterScript = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const filePath = process.argv[1];",
    "const sessionName = process.argv[2];",
    "const exitCode = Number(process.argv[3]);",
    "const command = process.argv[4];",
    "fs.mkdirSync(path.dirname(filePath), { recursive: true });",
    "fs.writeFileSync(filePath, JSON.stringify({ sessionName, exitCode, command, exitedAt: new Date().toISOString() }) + '\\n');",
  ].join(" ");

  const exports = [
    `export PATH=${shellQuote(params.wrapperDir)}:"$PATH"`,
    `export CLISBOT_BIN=${shellQuote(params.wrapperPath)}`,
  ];

  return [
    ...exports,
    `rm -f ${shellQuote(exitRecordPath)}`,
    runnerCommand,
    "status=$?",
    `node -e ${shellQuote(exitWriterScript)} ${shellQuote(exitRecordPath)} ${shellQuote(params.sessionName)} "$status" ${shellQuote(runnerCommand)} || true`,
    // Keep the pane alive briefly after a failed start so clisbot can read
    // and classify the runner's final error output before the session closes.
    `if [ "$status" -ne 0 ]; then echo ${shellQuote(`${RUNNER_EXIT_SENTINEL_PREFIX} `)}"$status"; sleep ${exitLingerSeconds}; fi`,
    'exit "$status"',
  ].join("; ");
}

export async function clearRunnerExitRecord(stateDir: string, sessionName: string) {
  const exitRecordPath = getRunnerExitRecordPath(stateDir, sessionName);
  if (!(await fileExists(exitRecordPath))) {
    return;
  }

  try {
    await unlink(exitRecordPath);
  } catch {
    // Ignore cleanup failures and keep runtime behavior unchanged.
  }
}

export async function readRunnerExitRecord(
  stateDir: string,
  sessionName: string,
): Promise<RunnerExitRecord | null> {
  const exitRecordPath = getRunnerExitRecordPath(stateDir, sessionName);
  if (!(await fileExists(exitRecordPath))) {
    return null;
  }

  try {
    const text = await readTextFile(exitRecordPath);
    const parsed = JSON.parse(text) as Partial<RunnerExitRecord>;
    const exitCode = parsed.exitCode;
    if (
      typeof parsed.sessionName !== "string" ||
      typeof exitCode !== "number" ||
      !Number.isFinite(exitCode) ||
      typeof parsed.command !== "string" ||
      typeof parsed.exitedAt !== "string"
    ) {
      return null;
    }

    return {
      sessionName: parsed.sessionName,
      exitCode,
      command: parsed.command,
      exitedAt: parsed.exitedAt,
    };
  } catch {
    return null;
  }
}

export async function ensureRunnerExitRecordDir(stateDir: string, sessionName: string) {
  await ensureDir(dirname(getRunnerExitRecordPath(stateDir, sessionName)));
}

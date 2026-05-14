import { sleep } from "../../infra/process.ts";
import { deriveInteractionText, normalizePaneText } from "../transcript/index.ts";
import type { TmuxClient } from "./client.ts";

const BASH_WINDOW_NAME = "bash";
const BASH_WINDOW_STARTUP_DELAY_MS = 150;
const SHELL_COMMAND_SUBMIT_DELAY_MS = 50;
const SHELL_COMMAND_POLL_INTERVAL_MS = 250;

export type TmuxShellSession = {
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  stream: {
    captureLines: number;
    maxRuntimeMs: number;
  };
};

export type TmuxShellCommandResult = {
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
};

export async function ensureTmuxShellPane(params: {
  tmux: TmuxClient;
  session: TmuxShellSession;
}) {
  const existingPaneId = await params.tmux.findPaneByWindowName(
    params.session.sessionName,
    BASH_WINDOW_NAME,
  );
  if (existingPaneId) {
    return existingPaneId;
  }

  const paneId = await params.tmux.newWindow({
    sessionName: params.session.sessionName,
    cwd: params.session.workspacePath,
    name: BASH_WINDOW_NAME,
    command: buildIsolatedBashCommand(),
  });
  await sleep(BASH_WINDOW_STARTUP_DELAY_MS);
  return paneId;
}

export async function runTmuxShellCommand(params: {
  tmux: TmuxClient;
  session: TmuxShellSession;
  paneId: string;
  command: string;
}): Promise<TmuxShellCommandResult> {
  const sentinel = `__TMUX_TALK_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const startedAt = Date.now();
  const captureLines = Math.max(params.session.stream.captureLines, 240);
  const sentinelPattern = new RegExp(`${escapeRegExp(sentinel)}:(\\d+)`);
  const initialSnapshot = normalizePaneText(
    await params.tmux.captureTarget(params.paneId, captureLines),
  );
  let lastInteractionSnapshot = "";

  await submitShellCommand(params.tmux, params.paneId, params.command);
  await submitShellCommand(
    params.tmux,
    params.paneId,
    `printf '\\n${sentinel}:%s\\n' "$?"`,
  );

  while (Date.now() - startedAt < params.session.stream.maxRuntimeMs) {
    await sleep(SHELL_COMMAND_POLL_INTERVAL_MS);
    const snapshot = normalizePaneText(await params.tmux.captureTarget(params.paneId, captureLines));
    const interactionSnapshot = deriveInteractionText(initialSnapshot, snapshot);
    lastInteractionSnapshot = interactionSnapshot;
    const match = interactionSnapshot.match(sentinelPattern);
    if (!match) {
      continue;
    }

    const exitCode = Number.parseInt(match[1] ?? "1", 10);
    const output = stripShellCommandEcho(
      interactionSnapshot.slice(0, match.index ?? interactionSnapshot.length).trim(),
      params.command,
      sentinel,
    );
    return buildShellResult({
      session: params.session,
      command: params.command,
      output,
      exitCode,
      timedOut: false,
    });
  }

  return buildShellResult({
    session: params.session,
    command: params.command,
    output: stripShellCommandEcho(lastInteractionSnapshot.trim(), params.command, sentinel),
    exitCode: 124,
    timedOut: true,
  });
}

function buildIsolatedBashCommand() {
  return `env PS1= HISTFILE=/dev/null bash --noprofile --norc -i`;
}

async function submitShellCommand(tmux: TmuxClient, paneId: string, command: string) {
  await tmux.sendLiteralTarget(paneId, command);
  await sleep(SHELL_COMMAND_SUBMIT_DELAY_MS);
  await tmux.sendKeyTarget(paneId, "Enter");
}

function buildShellResult(params: {
  session: TmuxShellSession;
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
}) {
  return {
    agentId: params.session.agentId,
    sessionKey: params.session.sessionKey,
    sessionName: params.session.sessionName,
    workspacePath: params.session.workspacePath,
    command: params.command,
    output: params.output,
    exitCode: params.exitCode,
    timedOut: params.timedOut,
  };
}

function stripShellCommandEcho(output: string, command: string, sentinel?: string) {
  let lines = output.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  while (lines[0]?.trim() === "") {
    lines = lines.slice(1);
  }

  const commandLines = command
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(index === all.length - 1 && line === ""));

  if (
    commandLines.length > 0 &&
    commandLines.every((line, index) => (lines[index] ?? "").trimEnd() === line)
  ) {
    lines = lines.slice(commandLines.length);
    while (lines[0]?.trim() === "") {
      lines = lines.slice(1);
    }
  }

  if (sentinel) {
    lines = lines.filter((line) => !line.includes(sentinel));
  }

  return lines.join("\n").trim();
}

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

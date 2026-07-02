// Runner launch argument planning for the tmux backend: which command and
// args start the runner for a fresh, explicit-id, or resume launch.

import type { ResolvedAgentTarget } from "../../agents/routing/resolved-target.ts";
import { applyTemplate } from "../../infra/paths.ts";

export function buildRunnerArgs(
  resolved: ResolvedAgentTarget,
  params: { sessionId?: string; resume?: boolean },
) {
  const values = {
    agentId: resolved.agentId,
    workspace: resolved.workspacePath,
    sessionName: resolved.sessionName,
    sessionKey: resolved.sessionKey,
    sessionId: params.sessionId ?? "",
  };
  const sessionId = params.sessionId?.trim();

  if (sessionId && params.resume && resolved.runner.sessionId.resume.mode === "command") {
    return {
      command: resolved.runner.sessionId.resume.command ?? resolved.runner.command,
      args: resolved.runner.sessionId.resume.args.map((value) => applyTemplate(value, values)),
    };
  }

  const args = [...resolved.runner.args];
  if (sessionId && resolved.runner.sessionId.create.mode === "explicit") {
    args.push(...resolved.runner.sessionId.create.args);
  }

  return {
    command: resolved.runner.command,
    args: args.map((value) => applyTemplate(value, values)),
  };
}

export function renderRunnerResumeCommand(
  resolved: ResolvedAgentTarget,
  sessionId: string,
) {
  if (resolved.runner.sessionId.resume.mode !== "command") {
    return undefined;
  }
  const launch = buildRunnerArgs(resolved, { sessionId, resume: true });
  return [launch.command, ...launch.args].join(" ");
}

export function canRestartWithStoredSessionId(resolved: ResolvedAgentTarget) {
  return (
    resolved.runner.sessionId.resume.mode === "command" ||
    resolved.runner.sessionId.create.mode === "explicit"
  );
}

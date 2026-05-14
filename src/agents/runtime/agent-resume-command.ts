import { applyTemplate } from "../../infra/paths.ts";
import type { ResolvedAgentTarget } from "../routing/resolved-target.ts";

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildCommandString(command: string, args: string[]) {
  return [command, ...args].map(shellQuote).join(" ");
}

function stripWorkspaceArgs(args: string[]) {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "-C") {
      index += 1;
      continue;
    }
    filtered.push(current);
  }
  return filtered;
}

export function buildResumeCommandPreview(
  resolved: ResolvedAgentTarget,
  sessionId?: string,
) {
  if (!sessionId || resolved.runner.sessionId.resume.mode !== "command") {
    return undefined;
  }

  const values = {
    agentId: resolved.agentId,
    workspace: resolved.workspacePath,
    sessionName: resolved.sessionName,
    sessionKey: resolved.sessionKey,
    sessionId,
  };
  const command = resolved.runner.sessionId.resume.command ?? resolved.runner.command;
  const args = stripWorkspaceArgs(
    resolved.runner.sessionId.resume.args.map((value) => applyTemplate(value, values)),
  );
  return buildCommandString(command, args);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const SENSITIVE_FLAGS = new Set(["--api-key", "--credential", "--password", "--secret", "--token"]);

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(command, args, {
      cwd,
      env,
      maxBuffer: 10_000_000,
    });
  } catch {
    const cause = new Error("child process exited unsuccessfully; raw diagnostics discarded");
    throw new Error(`${command} ${redactCommandArguments(args).join(" ")} failed`, { cause });
  }
}

function redactCommandArguments(args: readonly string[]): string[] {
  return args.flatMap((argument, index) => {
    if (index > 0 && SENSITIVE_FLAGS.has(args[index - 1]!)) return [];
    const flag = argument.split("=", 1)[0]!;
    return SENSITIVE_FLAGS.has(flag) ? [`${flag} <redacted>`] : [];
  });
}

// Never request argv from ps. A provider or connector can pass credentials under any flag.
const diagnosticExecutables = new Set(["node", "claude", "codex", "opencode", "git", "sh", "bash"]);

export async function describeProcesses(pids: readonly number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  const selected = new Set(pids);
  const { stdout } = await exec("ps", ["-ax", "-o", "pid=,ppid=,state=,etime=,ucomm="]);
  const descriptions: string[] = [];
  for (const line of stdout.split("\n")) {
    const row = /^\s*(\d+)\s+(\d+)\s+([\w+<>-]+)\s+([\d:-]+)\s+(.+?)\s*$/u.exec(line);
    if (!row || !selected.has(Number(row[1]))) continue;
    const executable = row[5] ?? "";
    const label = diagnosticExecutables.has(executable) ? executable : "other";
    descriptions.push(`${row[1]} ${row[2]} ${row[3]} ${row[4]} ${label}`);
  }
  return descriptions;
}

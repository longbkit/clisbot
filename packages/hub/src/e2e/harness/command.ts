import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const SENSITIVE_FLAGS = new Set(["--api-key", "--credential", "--password", "--secret", "--token"]);

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(command, args, {
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 10_000_000,
    });
  } catch {
    const cause = new Error("child process exited unsuccessfully; raw diagnostics discarded");
    throw new Error(`${command} ${redactCommandArguments(args).join(" ")} failed`, { cause });
  }
}

function redactCommandArguments(args: readonly string[]): string[] {
  return args.map((argument, index) => {
    if (index > 0 && SENSITIVE_FLAGS.has(args[index - 1]!)) return "<redacted>";
    const equals = /^(--(?:api-key|credential|password|secret|token))=(.*)$/iu.exec(argument);
    return equals ? `${equals[1]}=<redacted>` : argument;
  });
}

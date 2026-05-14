import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function commandExists(command: string) {
  if (!command.trim()) {
    return false;
  }

  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }

  const pathValue = process.env.PATH ?? "";
  const pathEntries = pathValue.split(delimiter).filter(Boolean);
  const executableNames = getExecutableNames(command);

  for (const directory of pathEntries) {
    for (const executableName of executableNames) {
      if (existsSync(join(directory, executableName))) {
        return true;
      }
    }
  }

  return false;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
    new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        resolve(code ?? 1);
      });
    }),
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getExecutableNames(command: string) {
  if (process.platform !== "win32") {
    return [command];
  }

  const ext = command.includes(".") ? "" : ".exe";
  const pathExt = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (ext) {
    return pathExt.map((value) => `${command}${value}`);
  }

  return [command];
}

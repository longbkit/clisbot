import { existsSync } from "node:fs";
import path from "node:path";

/** Electron's OS main script must be physical; imported JS may remain in asar. */
export function packagedNodeEntrypointRunner(entry: string): string | undefined {
  const archive = /^(.*?\.asar)(?=[/\\])/.exec(entry)?.[1];
  if (!archive) return undefined;
  const paths = entry.includes("\\") ? path.win32 : path;
  const runner = paths.join(`${archive}.unpacked`, "dist", "daemon", "node-entrypoint-runner.js");
  if (!existsSync(runner)) throw new Error("Packaged Clisbot Node entrypoint runner is missing");
  return runner;
}

export function nodeEntrypointArguments(entry: string, args: string[] = []): string[] {
  const runner = packagedNodeEntrypointRunner(entry);
  return runner
    ? [runner, "node-script", entry, ...args]
    : [...(entry.endsWith(".ts") ? ["--import", "tsx"] : []), entry, ...args];
}

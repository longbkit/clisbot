import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { ensureDir, expandHomePath, resolveAppHomeDir } from "../shared/paths.ts";

export function getDefaultClisbotBinDir(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "bin");
}

export function getDefaultClisbotWrapperPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultClisbotBinDir(env), "clisbot");
}

export const DEFAULT_CLISBOT_BIN_DIR = getDefaultClisbotBinDir();
export const DEFAULT_CLISBOT_WRAPPER_PATH = getDefaultClisbotWrapperPath();

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function getClisbotMainScriptPath() {
  return fileURLToPath(new URL("../main.ts", import.meta.url));
}

function isPackagedRuntime() {
  const currentModulePath = fileURLToPath(import.meta.url);
  return currentModulePath.includes(`${sep}dist${sep}`);
}

export function getClisbotWrapperPath() {
  return expandHomePath(process.env.CLISBOT_WRAPPER_PATH || getDefaultClisbotWrapperPath());
}

export function getClisbotPromptCommand() {
  if (process.env.CLISBOT_PROMPT_COMMAND?.trim()) {
    return process.env.CLISBOT_PROMPT_COMMAND.trim();
  }

  return isPackagedRuntime() ? "clis" : getClisbotWrapperPath();
}

export function getClisbotWrapperDir() {
  return dirname(getClisbotWrapperPath());
}

export function renderClisbotWrapperScript() {
  const execPath = process.execPath;
  const mainScriptPath = getClisbotMainScriptPath();

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec ${shellQuote(execPath)} ${shellQuote(mainScriptPath)} "$@"`,
    "",
  ].join("\n");
}

export async function ensureClisbotWrapper() {
  const wrapperPath = getClisbotWrapperPath();
  const wrapperDir = dirname(wrapperPath);
  await ensureDir(wrapperDir);

  const nextScript = renderClisbotWrapperScript();
  const existing = await fileExists(wrapperPath) ? await readTextFile(wrapperPath) : null;
  if (existing !== nextScript) {
    await writeTextFile(wrapperPath, nextScript);
  }

  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

export {
  buildRunnerLaunchCommand,
  clearRunnerExitRecord,
  ensureRunnerExitRecordDir,
  readRunnerExitRecord,
} from "./runner-exit-diagnostics.ts";

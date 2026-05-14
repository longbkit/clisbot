import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { fileExists, readTextFile, writeTextFile } from "../../infra/fs.ts";
import { ensureDir, expandHomePath, resolveAppHomeDir } from "../../infra/paths.ts";
import {
  DEFAULT_CLISBOT_CLI_NAME,
  getRenderedCliName,
} from "./cli-name.ts";

export function getDefaultClisbotBinDir(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "bin");
}

export function getDefaultClisbotWrapperPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultClisbotBinDir(env), DEFAULT_CLISBOT_CLI_NAME);
}

export const DEFAULT_CLISBOT_BIN_DIR = getDefaultClisbotBinDir();
export const DEFAULT_CLISBOT_WRAPPER_PATH = getDefaultClisbotWrapperPath();

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function getClisbotMainScriptPath(moduleUrl = import.meta.url) {
  if (isPackagedRuntime(moduleUrl)) {
    return fileURLToPath(moduleUrl);
  }

  return fileURLToPath(new URL("../main.ts", moduleUrl));
}

function isPackagedRuntime(moduleUrl = import.meta.url) {
  const currentModulePath = fileURLToPath(moduleUrl);
  return currentModulePath.includes(`${sep}dist${sep}`);
}

export function getClisbotWrapperPath() {
  return expandHomePath(process.env.CLISBOT_WRAPPER_PATH || getDefaultClisbotWrapperPath());
}

export function getClisbotPromptCommand() {
  if (process.env.CLISBOT_PROMPT_COMMAND?.trim()) {
    return process.env.CLISBOT_PROMPT_COMMAND.trim();
  }

  return isPackagedRuntime() ? getRenderedCliName() : getClisbotWrapperPath();
}

export function getClisbotWrapperDir() {
  return dirname(getClisbotWrapperPath());
}

export function renderClisbotWrapperScript(options: {
  moduleUrl?: string;
} = {}) {
  const execPath = process.execPath;
  const mainScriptPath = getClisbotMainScriptPath(options.moduleUrl);
  const cliName = getRenderedCliName();

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec ${shellQuote(execPath)} ${shellQuote(mainScriptPath)} --internal-cli-name ${shellQuote(cliName)} "$@"`,
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
} from "../runner/runner-exit-diagnostics.ts";

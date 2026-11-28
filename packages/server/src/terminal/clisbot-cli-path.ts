import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";

// Where the Clisbot CLI lives, for the PATH entry and CLISBOT_HOOK_CLI every terminal gets. Kept
// apart from terminal.ts so the daemon can resolve it without loading node-pty.

const require = createRequire(import.meta.url);
const CLISBOT_CLI_BIN_ENTRY = "@clisbot/cli/bin/clisbot";

export function resolveExternalProcessPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export function resolveClisbotCliBinDir(): string | null {
  const cliExecutable = resolveClisbotCliExecutablePath();
  return cliExecutable ? dirname(cliExecutable) : null;
}

export function resolveClisbotCliExecutablePath(): string | null {
  const configuredCli = process.env.CLISBOT_CLI?.trim();
  if (configuredCli) {
    return resolvePath(configuredCli);
  }

  const cliEntrypoint = resolveClisbotCliBinEntrypoint();
  if (!cliEntrypoint) {
    return null;
  }

  const externalCliEntrypoint = resolveExternalProcessPath(cliEntrypoint);
  const npmBinDir = findNpmBinDir(dirname(externalCliEntrypoint));
  if (npmBinDir) {
    const shim = resolveClisbotCliShim(npmBinDir);
    if (shim) {
      return shim;
    }
  }

  return externalCliEntrypoint;
}

function resolveClisbotCliBinEntrypoint(): string | null {
  try {
    return require.resolve(CLISBOT_CLI_BIN_ENTRY);
  } catch {
    return null;
  }
}

function findNpmBinDir(startPath: string): string | null {
  let current = startPath;
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (hasClisbotCliShim(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasClisbotCliShim(binDir: string): boolean {
  return resolveClisbotCliShim(binDir) !== null;
}

function resolveClisbotCliShim(binDir: string): string | null {
  for (const name of clisbotCliShimNames()) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function clisbotCliShimNames(): string[] {
  return process.platform === "win32" ? ["clisbot.cmd", "clisbot.exe", "clisbot"] : ["clisbot"];
}

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Electron reads archived modules through the existing unpacked Node runner. */
export function localCliLaunch(
  bin: string,
  exists = existsSync,
): { args: string[]; packaged: boolean } | undefined {
  const archive = /^(.*\.asar)[/\\]/.exec(bin)?.[1];
  if (!archive) return exists(bin) ? { args: [bin], packaged: false } : undefined;
  const paths = bin.includes("\\") ? path.win32 : path.posix;
  const entrypoint = paths.resolve(paths.dirname(bin), "..", "dist", "index.js");
  const runner = paths.join(`${archive}.unpacked`, "dist", "daemon", "node-entrypoint-runner.js");
  if (!exists(entrypoint) || !exists(runner)) return undefined;
  return {
    args: ["--disable-warning=DEP0040", runner, "node-script", entrypoint],
    packaged: true,
  };
}

export function localCliEntrypoint(): string | undefined {
  try {
    // Reuse the installed JS entrypoint; shell shims are not an API boundary.
    const bin = require.resolve("@clisbot/cli/bin/clisbot");
    return localCliLaunch(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs an owner-approved CLI command for this Host and parses its `--json` output.
 * Lifecycle that the CLI owns (Hub, gateway, Tailscale Serve) stays there; the
 * daemon only asks for it.
 */
export async function runLocalCliJson(options: {
  home: string;
  args: string[];
  timeoutMs: number;
  failure: string;
}): Promise<unknown> {
  const entrypoint = localCliEntrypoint();
  const launch = entrypoint ? localCliLaunch(entrypoint) : undefined;
  if (!launch) throw new Error("Install the Clisbot CLI on this Host first");
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [...launch.args, ...options.args],
      {
        env: {
          ...process.env,
          CLISBOT_HOME: options.home,
          ...(launch.packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        timeout: options.timeoutMs,
        maxBuffer: 128 * 1024,
        windowsHide: true,
      },
      (error, output) => {
        // CLI output may contain grants. Never copy it into logs/error messages.
        if (error) reject(new Error(options.failure));
        else resolve(output);
      },
    );
  });
  try {
    return JSON.parse(stdout);
  } catch {
    // JSON.parse quotes the input it rejects, and that input may hold a grant.
    throw new Error(options.failure);
  }
}

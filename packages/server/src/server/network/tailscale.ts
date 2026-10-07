import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// Read-only Tailscale observation shared by the daemon and the CLI. Changing a
// Serve mapping stays in the CLI, which owns the gateway it points at.
const execute = promisify(execFile);
export type TailscaleStatus =
  | { state: "ready"; dnsName: string }
  | { state: "missing" | "login-required" | "stopped"; guidance: string };
export interface TailscaleRunner {
  (args: string[]): Promise<string>;
}

export function resolveTailscaleBinary(
  platform = process.platform,
  env = process.env,
  exists = existsSync,
): string {
  const windowsPath = path.join(
    env.ProgramFiles ?? "C:\\Program Files",
    "Tailscale",
    "tailscale.exe",
  );
  if (env.CLISBOT_TAILSCALE_BIN) return env.CLISBOT_TAILSCALE_BIN;
  if (platform === "darwin") {
    const applicationBinary = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (exists(applicationBinary)) return applicationBinary;
  }
  if (platform !== "win32") return "tailscale";
  return exists(windowsPath) ? windowsPath : "tailscale.exe";
}

export const runTailscale: TailscaleRunner = async (args) => {
  const binary = resolveTailscaleBinary();
  return (
    await execute(binary, args, {
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      // The macOS GUI bundle shares its executable with the CLI. Without this,
      // launching from Electron can open its UI instead of returning status JSON.
      env: { ...process.env, TAILSCALE_BE_CLI: "1" },
    })
  ).stdout;
};

export async function detectTailscale(
  run: TailscaleRunner = runTailscale,
): Promise<TailscaleStatus> {
  try {
    const status = JSON.parse(await run(["status", "--json"])) as {
      BackendState?: string;
      Self?: { DNSName?: string };
    };
    if (status.BackendState === "NeedsLogin")
      return {
        state: "login-required",
        guidance:
          "Sign in to the Tailscale app (or run `tailscale up`), then retry. Also install/sign in to Tailscale on your phone.",
      };
    if (status.BackendState !== "Running" || !status.Self?.DNSName)
      return {
        state: "stopped",
        guidance: "Start the Tailscale service, sign in and enable MagicDNS, then retry.",
      };
    const dnsName = status.Self.DNSName.replace(/\.$/, "");
    if (!/^[a-zA-Z0-9.-]+\.ts\.net$/.test(dnsName)) throw new Error("Invalid Tailscale DNS name");
    return { state: "ready", dnsName };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        state: "missing",
        guidance:
          "Install Tailscale from https://tailscale.com/download, sign in on this machine and your phone, then retry.",
      };
    return {
      state: "stopped",
      guidance: `Tailscale could not be inspected: ${error instanceof Error ? error.message : String(error)}. On Windows use an Admin terminal for Serve.`,
    };
  }
}

export interface TailscaleServeHandler {
  proxy: string | undefined;
}

/** The handler Tailscale Serve has for `https://<authority>/`, if any. A handler
 * that is not a proxy still belongs to someone; callers must not replace it. */
export async function readTailscaleServeHandler(
  authority: string,
  run: TailscaleRunner = runTailscale,
): Promise<TailscaleServeHandler | undefined> {
  const status = JSON.parse(await run(["serve", "status", "--json"])) as {
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  const handler = status.Web?.[authority]?.Handlers?.["/"];
  return handler ? { proxy: handler.Proxy } : undefined;
}

/**
 * When Serve is not enabled on the tailnet, Tailscale prints an admin link and
 * waits. The link is the only way forward, so callers surface it.
 */
export function tailscaleApprovalUrl(error: unknown): string | undefined {
  const output = [
    error instanceof Error ? error.message : String(error),
    (error as { stdout?: unknown }).stdout,
    (error as { stderr?: unknown }).stderr,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");
  return /https:\/\/login\.tailscale\.com\/f\/[^\s"']+/.exec(output)?.[0];
}

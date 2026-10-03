import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { writeServiceFile } from "../../utils/service-files.js";

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

export async function configureTailscaleServe(
  options: { home: string; dnsName: string; port: number; target: string },
  run: TailscaleRunner = runTailscale,
): Promise<string> {
  const recordPath = path.join(options.home, "tailscale-serve.json");
  const record = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as { authority: string; target: string })
    : undefined;
  const authority = `${options.dnsName}:${options.port}`;
  const status = JSON.parse(await run(["serve", "status", "--json"])) as {
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  const current = status.Web?.[authority]?.Handlers?.["/"];
  if (current && (current.Proxy !== record?.target || record?.authority !== authority)) {
    throw new Error(
      `Tailscale Serve already owns https://${authority}/. Choose another --https-port; its mapping was preserved.`,
    );
  }
  await run(["serve", "--bg", `--https=${options.port}`, "--set-path=/", options.target]);
  writeServiceFile(recordPath, { authority, target: options.target });
  return new URL(`https://${authority}`).origin;
}

export async function removeTailscaleServe(
  home: string,
  run: TailscaleRunner = runTailscale,
): Promise<void> {
  const recordPath = path.join(home, "tailscale-serve.json");
  if (!existsSync(recordPath)) return;
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
    authority: string;
    target: string;
  };
  const status = JSON.parse(await run(["serve", "status", "--json"])) as {
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  const current = status.Web?.[record.authority]?.Handlers?.["/"];
  if (current && current.Proxy !== record.target)
    throw new Error("Tailscale mapping changed outside Clisbot; it was preserved");
  const port = new URL(`https://${record.authority}`).port || "443";
  if (current) await run(["serve", `--https=${port}`, "--set-path=/", "off"]);
  unlinkSync(recordPath);
}

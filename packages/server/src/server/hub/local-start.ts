import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { HubDeviceOfferSchema } from "@clisbot/protocol/device-pairing-offer";
import { HubLocalStartOptionsSchema, type HubLocalStartResult } from "@clisbot/protocol/hub-local";
import { readPersistedConfig } from "../persisted-config.js";

const require = createRequire(import.meta.url);
const active = new Set<string>();
const ResultSchema = z.object({
  url: z.string().min(1).max(16384),
  hubOffer: HubDeviceOfferSchema,
  origin: z.string().max(2048).optional(),
  transport: z.enum(["tailscale", "relay", "local", "https"]).optional(),
  networkGuidance: z.string().max(4096).optional(),
  tailscaleState: z
    .enum(["ready", "missing", "stopped", "login-required", "unavailable"])
    .optional(),
});

/** Electron reads archived modules through the existing unpacked Node runner. */
export function localHubCliLaunch(
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

export function localHubCliEntrypoint(): string | undefined {
  try {
    // Reuse the installed JS entrypoint; shell shims are not an API boundary.
    const bin = require.resolve("@clisbot/cli/bin/clisbot");
    return localHubCliLaunch(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

/** Explicit owner action delegates lifecycle to CLI; Hub traffic bypasses daemon. */
export async function startHostLocalHub(
  home: string,
  rawOptions: unknown,
): Promise<HubLocalStartResult> {
  const options = HubLocalStartOptionsSchema.parse(rawOptions);
  const entrypoint = localHubCliEntrypoint();
  const launch = entrypoint ? localHubCliLaunch(entrypoint) : undefined;
  if (!launch) throw new Error("Install the Clisbot CLI on this Host to start a Hub");
  const config = readPersistedConfig(home, { defaultsIfMissing: true });
  if (!config.features?.devicePairing) throw new Error("Protected device access is required");
  if (config.daemon?.managedAccess?.mode !== "off")
    throw new Error("Start a Hub using the Host's local CLI while managed access is enabled");
  if (active.has(home)) throw new Error("A Hub is already starting on this Host; wait and retry");
  active.add(home);
  const args = [
    ...launch.args,
    "hub",
    "start",
    "--personal",
    "--home",
    home,
    "--transport",
    options.transport ?? "tailscale",
    "--json",
  ];
  if (options.label) args.push("--label", options.label);
  if (options.publicUrl) args.push("--public-url", options.publicUrl);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        args,
        {
          env: {
            ...process.env,
            CLISBOT_HOME: home,
            ...(launch.packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          timeout: 100_000,
          maxBuffer: 128 * 1024,
          windowsHide: true,
        },
        (error, output) => {
          // CLI output may contain grants. Never copy it into logs/error messages.
          if (error) reject(new Error("Hub startup failed; inspect the Host's local service logs"));
          else resolve(output);
        },
      );
    });
    const result = ResultSchema.parse(JSON.parse(stdout));
    return {
      url: result.url,
      hub: result.hubOffer,
      origin: result.origin,
      transport: result.transport,
      ...(result.networkGuidance ? { networkGuidance: result.networkGuidance } : {}),
      ...(result.tailscaleState ? { tailscaleState: result.tailscaleState } : {}),
    };
  } finally {
    active.delete(home);
  }
}

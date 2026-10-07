import { z } from "zod";
import { TailscaleStateSchema, type HostTailscale } from "@clisbot/protocol/host-tailscale";
import { readDevicePairingConfiguration } from "../device-access/runtime.js";
import { runLocalCliJson } from "../local-cli.js";
import {
  detectTailscale,
  readTailscaleServeHandler,
  runTailscale,
  type TailscaleRunner,
} from "./tailscale.js";

const active = new Set<string>();
const SetupResultSchema = z.object({
  tailscaleState: TailscaleStateSchema.optional(),
  networkGuidance: z.string().max(4096).optional(),
  tailscaleActionUrl: z.string().max(2048).optional(),
});

/** What the pairing link offers over Tailscale right now, read without changing anything. */
export async function readHostTailscale(
  home: string,
  run: TailscaleRunner = runTailscale,
): Promise<HostTailscale> {
  const status = await detectTailscale(run);
  if (status.state !== "ready") return { state: status.state, guidance: status.guidance };
  const origin = await mappedOrigin(home, status.dnsName, run);
  return { state: "ready", dnsName: status.dnsName, ...(origin ? { origin } : {}) };
}

/**
 * Maps this Host through Tailscale Serve with the CLI path `clisbot onboard` uses.
 * Relay stays as the person left it; the daemon keeps running.
 */
export async function setUpHostTailscale(
  home: string,
  options: { httpsPort?: number } = {},
): Promise<HostTailscale> {
  const before = await readHostTailscale(home);
  if (before.state !== "ready" || before.origin) return before;
  if (active.has(home)) throw new Error("Tailscale is already being set up on this Host");
  active.add(home);
  try {
    const result = SetupResultSchema.parse(
      await runLocalCliJson({
        home,
        args: [
          "daemon",
          "pair",
          "--home",
          home,
          "--transport",
          "tailscale",
          ...(options.httpsPort ? ["--https-port", String(options.httpsPort)] : []),
          "--json",
        ],
        timeoutMs: 100_000,
        failure: "Tailscale setup failed; inspect the Host's local service logs",
      }),
    );
    if (result.tailscaleState && result.tailscaleState !== "ready")
      return {
        state: result.tailscaleState,
        ...(before.dnsName ? { dnsName: before.dnsName } : {}),
        ...(result.networkGuidance ? { guidance: result.networkGuidance } : {}),
        ...(result.tailscaleActionUrl ? { actionUrl: result.tailscaleActionUrl } : {}),
      };
    return await readHostTailscale(home);
  } finally {
    active.delete(home);
  }
}

async function mappedOrigin(
  home: string,
  dnsName: string,
  run: TailscaleRunner,
): Promise<string | undefined> {
  const { direct } = readDevicePairingConfiguration(home);
  if (!direct?.useTls) return undefined;
  const url = new URL(`https://${direct.endpoint}`);
  if (url.hostname !== dnsName) return undefined;
  // A mapping removed or replaced outside Clisbot no longer reaches this Host.
  const handler = await readTailscaleServeHandler(`${dnsName}:${url.port || "443"}`, run);
  return handler?.proxy ? url.origin : undefined;
}

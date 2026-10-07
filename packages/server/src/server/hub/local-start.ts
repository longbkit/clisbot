import { z } from "zod";
import { HubDeviceOfferSchema } from "@clisbot/protocol/device-pairing-offer";
import { HubLocalStartOptionsSchema, type HubLocalStartResult } from "@clisbot/protocol/hub-local";
import { TailscaleStateSchema } from "@clisbot/protocol/host-tailscale";
import { readPersistedConfig } from "../persisted-config.js";
import { runLocalCliJson } from "../local-cli.js";

const active = new Set<string>();
const ResultSchema = z.object({
  url: z.string().min(1).max(16384),
  hubOffer: HubDeviceOfferSchema,
  origin: z.string().max(2048).optional(),
  transport: z.enum(["tailscale", "relay", "local", "https"]).optional(),
  networkGuidance: z.string().max(4096).optional(),
  tailscaleState: TailscaleStateSchema.optional(),
});

/** Explicit owner action delegates lifecycle to CLI; Hub traffic bypasses daemon. */
export async function startHostLocalHub(
  home: string,
  rawOptions: unknown,
): Promise<HubLocalStartResult> {
  const options = HubLocalStartOptionsSchema.parse(rawOptions);
  const config = readPersistedConfig(home, { defaultsIfMissing: true });
  if (!config.features?.devicePairing) throw new Error("Protected device access is required");
  if (config.daemon?.managedAccess?.mode !== "off")
    throw new Error("Start a Hub using the Host's local CLI while managed access is enabled");
  if (active.has(home)) throw new Error("A Hub is already starting on this Host; wait and retry");
  active.add(home);
  const args = [
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
    const output = await runLocalCliJson({
      home,
      args,
      timeoutMs: 100_000,
      failure: "Hub startup failed; inspect the Host's local service logs",
    });
    const result = ResultSchema.parse(output);
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

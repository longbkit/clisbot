import { renderPairingQr } from "@clisbot/server/gateway-adapters";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { localControlCredentialPath } from "@clisbot/device-access/local-control";
import type { HubDeviceOffer } from "@clisbot/protocol/device-pairing-offer";
import { resolveLocalHubState, resolveLocalHubHome } from "./local-hub.js";

export async function localHubDeviceRequest(
  home: string,
  apiPath: string,
  method = "GET",
  body?: object,
): Promise<unknown> {
  const local = resolveLocalHubState({ home });
  if (!local.running || !local.state) throw new Error("Start the local Hub first");
  const dataDir = local.state.dataDirectory ?? process.env.CLISBOT_HUB_DATA_DIR ?? home;
  const credential = (await readFile(localControlCredentialPath(dataDir), "utf8")).trim();
  const response = await fetch(new URL(`/api/auth/clisbot/device${apiPath}`, local.state.url), {
    method,
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`Hub device operation failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

export async function localHubPairingOffer(options: {
  home: string;
  origin?: string;
  label?: string;
  ttlMs?: number;
}): Promise<HubDeviceOffer> {
  const local = resolveLocalHubState({ home: options.home });
  if (!local.running || !local.state) throw new Error("Start the local Hub first");
  const identity = await fetch(new URL("/api/auth/clisbot/device/identity", local.state.url), {
    signal: AbortSignal.timeout(5_000),
  });
  const value = (await identity.json()) as {
    hubId: string;
    publicKey?: string;
    devicePairing?: boolean;
    relay?: HubDeviceOffer["relay"];
  };
  if (!identity.ok || !value.devicePairing || !value.publicKey)
    throw new Error("This Hub needs device pairing enabled; existing Hub processes are preserved");
  const invitation = (await localHubDeviceRequest(options.home, "/invitations", "POST", {
    ...(options.label ? { label: options.label } : {}),
    ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
  })) as NonNullable<HubDeviceOffer["pairing"]> & { ownerSetupToken?: string };
  const { ownerSetupToken, ...pairing } = invitation;
  return {
    hubId: value.hubId,
    publicKey: value.publicKey,
    origin: options.origin ?? local.state.url,
    pairing,
    ...(ownerSetupToken ? { ownerSetupToken } : {}),
    ...(value.relay ? { relay: value.relay } : {}),
  };
}

export function addHubDevicePairingCommands(hub: Command): void {
  hub
    .command("pair")
    .description("Pair a device with a personal Hub or approve protected first-owner setup")
    .option("--home <path>")
    .option("--origin <url>", "Public/Tailscale gateway HTTPS origin")
    .option("--label <name>")
    .option("--ttl <seconds>", "Invitation lifetime", "300")
    .option("--json")
    .action(async (options) => {
      const seconds = Number(options.ttl);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 900)
        throw new Error("TTL must be 1–900 seconds");
      const offer = await localHubPairingOffer({
        ...options,
        home: resolveLocalHubHome(options),
        ttlMs: seconds * 1000,
      });
      const url = `https://app.clisbot.com/#offer=${Buffer.from(JSON.stringify({ v: 4, hub: offer })).toString("base64url")}`;
      if (options.json) console.log(JSON.stringify({ url, expiresAt: offer.pairing?.expiresAt }));
      else
        console.log(
          `${await renderPairingQr(url)}\nHub pairing (expires in ${seconds} seconds):\n${url}\nPrefer Tailscale on both devices; relay is available when configured.`,
        );
    });
  addHubDeviceCommands(hub);
  hub
    .command("login-policy")
    .argument("<required>", "on or off")
    .option("--home <path>")
    .description("Persist whether Hub access requires account sign-in")
    .action(async (required: string, options) => {
      if (!["on", "off"].includes(required)) throw new Error("Use on or off");
      console.log(
        JSON.stringify(
          await localHubDeviceRequest(resolveLocalHubHome(options), "/login-policy", "PUT", {
            required: required === "on",
          }),
        ),
      );
    });
}

function addHubDeviceCommands(hub: Command): void {
  const devices = hub.command("devices").description("List, label and revoke paired Hub devices");
  for (const verb of ["ls", "rename", "revoke"] as const) {
    const command = devices.command(verb).option("--home <path>");
    if (verb !== "ls") command.argument("<device-id>");
    if (verb === "rename") command.argument("<label>");
    command.action(async (...args) => {
      const options = args.at(-2) as { home?: string };
      const id = verb === "ls" ? "" : `/${encodeURIComponent(args[0])}`;
      console.log(
        JSON.stringify(
          await localHubDeviceRequest(
            resolveLocalHubHome(options),
            `/devices${id}`,
            ({ ls: "GET", rename: "PATCH", revoke: "DELETE" } as const)[verb],
            verb === "rename" ? { label: args[1] } : undefined,
          ),
          null,
          2,
        ),
      );
    });
  }
}

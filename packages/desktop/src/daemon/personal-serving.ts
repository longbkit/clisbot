import { existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { editPersistedConfig, readPersistedConfig } from "@clisbot/server/configuration";
import { runExternalCliJsonCommand } from "./cli/external.js";
import type { HubDeviceOffer } from "@clisbot/protocol/device-pairing-offer";

let pending: Promise<string> | undefined;
let cached: { home: string; url: string; expiresAt: number } | undefined;

export async function preparePersonalDesktopHome(
  home: string,
  webDirectory?: string,
): Promise<void> {
  if (existsSync(path.join(home, "config.json"))) return;
  editPersistedConfig(home, "features.personalServing", { value: true });
  editPersistedConfig(home, "features.devicePairing", { value: true });
  editPersistedConfig(home, "daemon.managedAccess.mode", { value: "off" });
  const listen = `127.0.0.1:${await availablePort()}`;
  editPersistedConfig(home, "daemon.listen", { value: listen });
  editPersistedConfig(home, "daemon.direct.endpoint", { value: listen });
  editPersistedConfig(home, "daemon.direct.useTls", { value: false });
  editPersistedConfig(home, "daemon.relay.enabled", { value: true });
  if (webDirectory) editPersistedConfig(home, "features.webUi.distDir", { value: webDirectory });
}

export async function personalDesktopPairing(home: string): Promise<string | undefined> {
  if (!readPersistedConfig(home, { defaultsIfMissing: true }).features?.personalServing) return;
  if (cached?.home === home && cached.expiresAt > Date.now() + 15_000) return cached.url;
  pending ??= compose(home).finally(() => {
    pending = undefined;
  });
  return pending;
}

/** A shareable invitation must be fresh; startup's cached QR may already be redeemed. */
export async function desktopDevicePairingOffer(home: string): Promise<unknown> {
  if (!readPersistedConfig(home, { defaultsIfMissing: true }).features?.devicePairing) return null;
  return runExternalCliJsonCommand(["daemon", "pair", "--home", home, "--json"]);
}

async function compose(home: string): Promise<string> {
  const result = (await runExternalCliJsonCommand([
    "daemon",
    "pair",
    "--home",
    home,
    "--label",
    "Desktop app",
    "--json",
  ])) as { url?: unknown };
  if (typeof result.url !== "string" || !result.url.includes("#offer="))
    throw new Error("Personal services did not return a pairing invitation");
  cached = { home, url: result.url, expiresAt: Date.now() + 285_000 };
  return result.url;
}

/** The explicit operator action creates a Hub grant; discovery alone never invokes this. */
export async function startDesktopHub(
  home: string,
  options: {
    transport?: string;
    publicUrl?: string;
    label?: string;
  },
): Promise<{
  url: string;
  hub: HubDeviceOffer;
  origin: string;
  transport: string;
  tailscaleState?: string;
  networkGuidance?: string;
}> {
  const result = (await runExternalCliJsonCommand([
    "hub",
    "start",
    "--personal",
    "--home",
    home,
    "--json",
    "--transport",
    options.transport ?? "tailscale",
    "--label",
    options.label ?? "Desktop app",
    ...(options.publicUrl ? ["--public-url", options.publicUrl] : []),
  ])) as {
    url?: unknown;
    hubOffer?: HubDeviceOffer;
    origin?: unknown;
    transport?: unknown;
    tailscaleState?: unknown;
    networkGuidance?: unknown;
  };
  if (
    typeof result.url !== "string" ||
    !result.hubOffer?.hubId ||
    typeof result.origin !== "string" ||
    typeof result.transport !== "string"
  )
    throw new Error("Hub startup did not return an approved connection offer");
  return {
    url: result.url,
    hub: result.hubOffer,
    origin: result.origin,
    transport: result.transport,
    ...(typeof result.tailscaleState === "string" ? { tailscaleState: result.tailscaleState } : {}),
    ...(typeof result.networkGuidance === "string"
      ? { networkGuidance: result.networkGuidance }
      : {}),
  };
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No loopback port available"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

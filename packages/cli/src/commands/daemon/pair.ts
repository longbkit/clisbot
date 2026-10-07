import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import { generateLocalPairingOffer } from "@clisbot/server/pairing";
import { detectTailscale } from "@clisbot/server/gateway-adapters";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import {
  readPersistedConfig,
  editPersistedConfig,
  resolveConfigFromPersisted,
} from "@clisbot/server/configuration";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";
import { formatPairingInstructions } from "../../output/pairing.js";
import { parseConnectionOfferFromUrl } from "@clisbot/protocol/connection-offer";
import { localHubPairingOffer } from "../hub/device-pairing.js";
import { resolveLocalHubState } from "../hub/local-hub.js";
import { serializeRelayConnectionUri } from "@clisbot/protocol/daemon-endpoints";
import {
  parseDevicePairingOfferFromUrl,
  type DevicePairingOffer,
} from "@clisbot/protocol/device-pairing-offer";

interface PairOptions {
  daemonTarget: DaemonTarget;
  home?: string;
  json?: boolean;
  relay?: boolean;
  devicePairing?: boolean;
  label?: string;
  ttl?: string;
  direct?: string;
  transport?: string;
  httpsPort?: string;
}

export interface PairCommandOutput {
  columns: number | undefined;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  setExitCode(code: number): void;
  success(message: string): void;
}

export interface PairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

const PAIRING_DAEMON_RPC_TIMEOUT_MS = 1500;
const RELAY_DOCS_URL = "https://clisbot.com/docs/security";

function createProcessOutput(): PairCommandOutput {
  return {
    columns: process.stdout.columns,
    writeStdout(message) {
      process.stdout.write(message);
    },
    writeStderr(message) {
      process.stderr.write(message);
    },
    setExitCode(code) {
      process.exitCode = code;
    },
    success(message) {
      log.success(message);
    },
  };
}

export function pairCommand(): Command {
  return addJsonAndDaemonHostOptions(
    new Command("pair").description("Print the daemon pairing QR code and link"),
  )
    .option("--relay", "Enable relay without prompting")
    .option(
      "--device-pairing",
      "Enable device credentials for an offline daemon; a live daemon must already support them",
    )
    .option("--label <name>", "Label the device being paired")
    .option("--ttl <seconds>", "Invitation lifetime, 1–900 seconds", "300")
    .option("--direct <url>", "Direct ws://localhost or wss:// endpoint (Tailscale preferred)")
    .option("--transport <kind>", "Set up a direct route before pairing: tailscale")
    .option("--https-port <port>", "Tailscale HTTPS port owned by Clisbot")
    .action(
      withGlobalOptions((options: PairOptions, _command: Command) => runPairCommand(options)),
    );
}

export async function resolveLocalPairingOffer(options: {
  clisbotHome: string;
  enableRelay?: boolean;
  devicePairing?: boolean;
  label?: string;
  ttlMs?: number;
  direct?: DevicePairingOffer["direct"];
  hub?: DevicePairingOffer["hub"];
}): Promise<PairingOffer> {
  const instance = await readDaemonInstance(options.clisbotHome);
  if (!instance && options.enableRelay)
    editPersistedConfig(options.clisbotHome, "daemon.relay.enabled", { value: true });
  if (!instance && options.devicePairing)
    editPersistedConfig(options.clisbotHome, "features.devicePairing", { value: true });
  const config = resolveConfigFromPersisted(
    options.clisbotHome,
    readPersistedConfig(options.clisbotHome, { defaultsIfMissing: true }),
    { env: {} },
  );

  const pairingOptions = {
    ...options,
    direct: options.direct ?? configuredDirect(options.clisbotHome),
    hub:
      options.hub ??
      (config.devicePairingEnabled
        ? await approvedLocalHubOffer(options.clisbotHome, options)
        : undefined),
  };
  if (instance)
    return resolveDaemonPairingOffer(
      { kind: "instance", home: options.clisbotHome },
      options.enableRelay,
      pairingOptions,
    );

  return generateLocalPairingOffer({
    clisbotHome: options.clisbotHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
    devicePairingEnabled: config.devicePairingEnabled,
    label: options.label,
    ttlMs: options.ttlMs,
    direct: pairingOptions.direct,
    hub: pairingOptions.hub,
    managedAccessMode: config.managedAccessMode,
  });
}

async function approvedLocalHubOffer(
  home: string,
  options: { label?: string; ttlMs?: number; direct?: DevicePairingOffer["direct"] },
): Promise<DevicePairingOffer["hub"]> {
  const local = resolveLocalHubState({ home });
  if (!local.running || !local.state || !(await readDaemonInstance(home))) return undefined;
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    const relationship = (await client.getHubStatus()).status;
    if (relationship.state !== "connected" || relationship.hubOrigin !== local.state.url)
      return undefined;
    const direct = options.direct ?? configuredDirect(home);
    const origin = direct
      ? `${direct.useTls ? "https" : "http"}://${direct.endpoint}`
      : local.state.url;
    return await localHubPairingOffer({
      home,
      origin,
      ...(options.label ? { label: options.label } : {}),
      ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
    });
  } finally {
    await client.close();
  }
}

async function resolveDaemonPairingOffer(
  target: DaemonTarget,
  enableRelay: boolean | undefined,
  options: {
    devicePairing?: boolean;
    label?: string;
    ttlMs?: number;
    direct?: DevicePairingOffer["direct"];
    hub?: DevicePairingOffer["hub"];
  } = {},
): Promise<PairingOffer> {
  const client = await connectToDaemon({
    target,
    timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
  });

  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.features?.daemonStatusRpc !== true) {
      throw new Error("Update the Clisbot daemon before pairing from this command.");
    }
    if (
      (options.devicePairing || options.label || options.direct || options.hub) &&
      serverInfo.features.devicePairing !== true
    ) {
      throw new Error(
        "Device pairing is not enabled on this running daemon. Save features.devicePairing=true and enable it at your next planned daemon restart.",
      );
    }

    let offer = await client.getDaemonPairingOffer({
      timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
      ...(serverInfo.features.devicePairing ? options : {}),
    });
    if (!offer.relayEnabled && enableRelay) {
      if (serverInfo.features.relayConfig !== true) {
        throw new Error("Update the Clisbot daemon before enabling relay from this command.");
      }
      await client.patchDaemonConfig({ relay: { enabled: true } });
      try {
        offer = await client.getDaemonPairingOffer({
          timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
          ...(serverInfo.features.devicePairing ? options : {}),
        });
      } catch (error) {
        throw new Error(
          `Relay configuration was saved, but fetching the pairing offer failed: ${String(error)}`,
          { cause: error },
        );
      }
    }
    return {
      relayEnabled: offer.relayEnabled,
      url: offer.url || null,
      qr: offer.qr ?? null,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function confirmRelayPairing(): Promise<boolean> {
  log.message(
    "Your connection is end-to-end encrypted. Clisbot cannot read your code or messages.",
  );
  log.message(`Learn how it works: ${RELAY_DOCS_URL}`);
  const answer = await confirm({
    message: "Enable relay to pair a device?",
    initialValue: false,
  });
  return !isCancel(answer) && answer;
}

export function printDirectConnectionGuidance(): void {
  console.log("Daemon is running with relay off.");
  console.log(
    "To connect another device directly, use the daemon's TCP address over your LAN, Tailscale, or another VPN.",
  );
  console.log(`Learn more: ${RELAY_DOCS_URL}#direct-connections`);
}

export async function runPairCommand(options: PairOptions): Promise<void> {
  const output = createProcessOutput();
  const target = options.daemonTarget;
  if (options.transport !== undefined) {
    await runTailscalePairing(options, output);
    return;
  }
  const ttlMs = Number(options.ttl ?? "300") * 1000;
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000)
    throw new Error("Invitation lifetime must be 1–900 seconds");
  const direct = options.direct ? directPairingEndpoint(options.direct) : undefined;
  const invitation = { devicePairing: options.devicePairing, label: options.label, ttlMs, direct };
  const resolveOffer = (enableRelay: boolean) =>
    target.kind === "instance"
      ? resolveLocalPairingOffer({ clisbotHome: target.home, enableRelay, ...invitation })
      : resolveDaemonPairingOffer(target, enableRelay, invitation);
  const offline = target.kind === "instance" && !(await readDaemonInstance(target.home));
  const pairing = await resolveOffer(options.relay === true);

  if (offline)
    output.writeStderr(
      `Offline pairing offer. Start with: clisbot daemon start --home ${JSON.stringify(target.kind === "instance" ? target.home : "")}\n`,
    );

  outputPairingResult(pairing, options, output);
}

function outputPairingResult(
  pairing: PairingOffer,
  options: PairOptions,
  output: PairCommandOutput,
): void {
  if (!pairing.url) {
    if (options.json) {
      output.writeStderr(
        `${JSON.stringify({
          code: "RELAY_DISABLED",
          message: "Relay pairing is disabled for this daemon.",
          action: "Run clisbot daemon pair --relay --json to enable it explicitly.",
        })}\n`,
      );
    } else {
      output.writeStderr(`${chalk.red("Relay pairing is disabled for this daemon.")}\n`);
      output.writeStderr(`${chalk.yellow("Run clisbot daemon pair --relay to enable it.")}\n`);
    }
    output.setExitCode(1);
    return;
  }

  const deviceOffer = parseDevicePairingOfferFromUrl(pairing.url);
  const offer = deviceOffer ? null : parseConnectionOfferFromUrl(pairing.url);
  const connectionUri =
    !deviceOffer && offer?.v === 2 ? serializeRelayConnectionUri({ offer }) : null;

  if (options.json) {
    output.writeStdout(
      `${JSON.stringify(
        { relayEnabled: pairing.relayEnabled, url: pairing.url, qr: pairing.qr, connectionUri },
        null,
        2,
      )}\n`,
    );
    return;
  }

  output.writeStdout(
    formatPairingInstructions({
      url: pairing.url,
      qr: pairing.qr,
      connectionUri,
      columns: output.columns,
    }),
  );
}

function directPairingEndpoint(value: string): NonNullable<DevicePairingOffer["direct"]> {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/ws"].includes(url.pathname)
  )
    throw new Error("Use a WebSocket endpoint ending at /ws");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback))
    throw new Error("Remote device pairing requires wss://; use Tailscale Serve for HTTPS");
  return {
    endpoint: `${url.hostname}:${url.port || (url.protocol === "wss:" ? "443" : "80")}`,
    useTls: url.protocol === "wss:",
  };
}

function configuredDirect(home: string): DevicePairingOffer["direct"] {
  const direct = readPersistedConfig(home, { defaultsIfMissing: true }).daemon?.direct;
  return direct?.endpoint ? { endpoint: direct.endpoint, useTls: direct.useTls } : undefined;
}

/** `--transport tailscale`: map this Host through Tailscale Serve, then print a link that
 * carries the Tailscale route. The app's Set up Tailscale runs this with `--json`. */
async function runTailscalePairing(options: PairOptions, output: PairCommandOutput): Promise<void> {
  if (options.transport !== "tailscale")
    throw new Error("--transport supports tailscale; use --direct for another route");
  if (options.direct) throw new Error("Choose either --direct or --transport");
  if (options.daemonTarget.kind !== "instance")
    throw new Error("Set up Tailscale on the Host itself (--home), not over --host");
  const status = await detectTailscale();
  if (status.state !== "ready") {
    const result = {
      transport: "tailscale",
      tailscaleState: status.state,
      networkGuidance: status.guidance,
    };
    if (options.json) output.writeStdout(`${JSON.stringify(result)}\n`);
    else output.writeStderr(`${status.guidance}\n`);
    if (!options.json) output.setExitCode(1);
    return;
  }
  // Dynamic: serve/index.ts imports this module's pairing helpers.
  const { startPersonalDaemon } = await import("../serve/index.js");
  const result = await startPersonalDaemon({
    home: options.daemonTarget.home,
    transport: "tailscale",
    httpsPort: options.httpsPort,
    label: options.label,
    json: options.json,
    preserveRelay: true,
  });
  if (options.json) {
    output.writeStdout(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.networkGuidance) output.writeStderr(`${result.networkGuidance}\n`);
  if (!result.url) {
    output.setExitCode(1);
    return;
  }
  output.writeStdout(`Tailscale: ${result.origin}\n`);
  output.writeStdout(
    formatPairingInstructions({
      url: result.url,
      qr: result.qr,
      connectionUri: null,
      columns: output.columns,
    }),
  );
}

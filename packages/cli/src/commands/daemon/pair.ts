import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import { generateLocalPairingOffer } from "@clisbot/server/pairing";
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
import { serializeRelayConnectionUri } from "@clisbot/protocol/daemon-endpoints";

interface PairOptions {
  daemonTarget: DaemonTarget;
  home?: string;
  json?: boolean;
  relay?: boolean;
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
    .action(
      withGlobalOptions((options: PairOptions, _command: Command) => runPairCommand(options)),
    );
}

export async function resolveLocalPairingOffer(options: {
  clisbotHome: string;
  enableRelay?: boolean;
}): Promise<PairingOffer> {
  const instance = await readDaemonInstance(options.clisbotHome);
  if (instance)
    return resolveDaemonPairingOffer(
      { kind: "instance", home: options.clisbotHome },
      options.enableRelay,
    );
  if (options.enableRelay)
    editPersistedConfig(options.clisbotHome, "daemon.relay.enabled", { value: true });
  const config = resolveConfigFromPersisted(
    options.clisbotHome,
    readPersistedConfig(options.clisbotHome, { defaultsIfMissing: true }),
    { env: {} },
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
  });
}

async function resolveDaemonPairingOffer(
  target: DaemonTarget,
  enableRelay: boolean | undefined,
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

    let offer = await client.getDaemonPairingOffer({
      timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
    });
    if (!offer.relayEnabled && enableRelay) {
      if (serverInfo.features.relayConfig !== true) {
        throw new Error("Update the Clisbot daemon before enabling relay from this command.");
      }
      await client.patchDaemonConfig({ relay: { enabled: true } });
      try {
        offer = await client.getDaemonPairingOffer({ timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS });
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
  const resolveOffer = (enableRelay: boolean) =>
    target.kind === "instance"
      ? resolveLocalPairingOffer({ clisbotHome: target.home, enableRelay })
      : resolveDaemonPairingOffer(target, enableRelay);
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
  if (!pairing.relayEnabled || !pairing.url) {
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

  const offer = parseConnectionOfferFromUrl(pairing.url);
  const connectionUri = offer ? serializeRelayConnectionUri({ offer }) : null;

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

import { select, isCancel } from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, editPersistedConfig } from "@clisbot/server/configuration";
import { readDaemonInstance, resolveClisbotHome } from "@clisbot/server/daemon-control";
import { launchLocalDaemon } from "../daemon/local-daemon.js";
import { resolveLocalPairingOffer } from "../daemon/pair.js";
import { prepareHub } from "./hub-launch.js";
import { configureServingAdmission } from "./network-admission.js";
import { localHubPairingOffer } from "../hub/device-pairing.js";
import { launchGateway } from "./gateway-launch.js";
import { configureTailscaleServe, detectTailscale, readTailscaleServePort } from "./tailscale.js";
import { selectLocalPort } from "../hub/local-port.js";
import { connectToDaemon } from "../../utils/client.js";
import { enrollPersonalDaemon } from "./enrollment.js";
import { withServiceLaunchLock } from "../../utils/service-launch-lock.js";
import { renderPairingQr } from "@clisbot/server/gateway-adapters";

export interface PersonalServingOptions {
  home?: string;
  transport?: string;
  publicUrl?: string;
  httpsPort?: string;
  webPort?: string;
  label?: string;
  json?: boolean;
  port?: string;
}

/** Internal composition behind the existing onboarding and Hub lifecycle commands. */
export async function startPersonalHub(
  options: PersonalServingOptions,
): Promise<PersonalServingResult> {
  const home = selectedHome(options);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const network = await servingNetwork(options);
  return withServiceLaunchLock(path.join(home, "serve-launch"), () =>
    launchServices(options, home, network),
  );
}

export async function startPersonalDaemon(
  options: PersonalServingOptions,
): Promise<PersonalDaemonResult> {
  const home = selectedHome(options);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const network = await servingNetwork(options);
  return withServiceLaunchLock(path.join(home, "serve-launch"), async () => {
    const daemon = await prepareDaemon(home, network.transport !== "local");
    await configureDaemonRelay(home, network.transport !== "local");
    const { gateway, origin, directEndpoint } = await exposeServices(
      options,
      home,
      network,
      daemon.origin,
      existingGatewayHub(home),
    );
    await configureServingAdmission(home, [origin, gateway.origin]);
    const pairing = await resolveLocalPairingOffer({
      clisbotHome: home,
      devicePairing: true,
      enableRelay: network.transport !== "local",
      direct: { endpoint: directEndpoint, useTls: origin.startsWith("https:") },
      ...(options.label ? { label: options.label } : {}),
    });
    if (network.transport !== "relay" && pairing.url) {
      pairing.url = `${origin}/${new URL(pairing.url).hash}`;
      pairing.qr = await renderPairingQr(pairing.url);
    }
    return {
      home,
      daemon: daemon.origin,
      gateway: gateway.origin,
      origin,
      transport: network.transport,
      tailscaleState: network.tailscaleState,
      networkGuidance: network.networkGuidance,
      ...pairing,
    };
  });
}

function selectedHome(options: PersonalServingOptions): string {
  return resolveClisbotHome({
    ...process.env,
    ...(options.home ? { CLISBOT_HOME: options.home } : {}),
  });
}

function existingGatewayHub(home: string): string | null {
  try {
    const state = JSON.parse(readFileSync(path.join(home, "gateway-local.json"), "utf8")) as {
      config?: { hubOrigin?: unknown };
    };
    const origin = state.config?.hubOrigin;
    if (typeof origin !== "string") return null;
    const url = new URL(origin);
    return url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      Boolean(url.port) &&
      url.origin === origin &&
      !url.username &&
      !url.password
      ? origin
      : null;
  } catch {
    return null;
  }
}

export interface PersonalDaemonResult {
  home: string;
  daemon: string;
  gateway: string;
  origin: string;
  transport: string;
  url: string | null;
  qr: string | null;
  relayEnabled: boolean;
  tailscaleState?: "ready" | "missing" | "login-required" | "stopped" | "unavailable";
  networkGuidance?: string;
}

export interface PersonalServingResult extends PersonalDaemonResult {
  hub: string;
  hubOffer: Awaited<ReturnType<typeof localHubPairingOffer>>;
  enrollment: "connected" | "account-approval-required";
}

async function launchServices(
  options: PersonalServingOptions,
  home: string,
  network: Awaited<ReturnType<typeof servingNetwork>>,
): Promise<PersonalServingResult> {
  const daemon = await prepareDaemon(home, network.transport !== "local");
  await configureDaemonRelay(home, network.transport !== "local");
  let hub = await prepareHub(
    home,
    network.origin ?? `http://127.0.0.1:${options.webPort ?? "6880"}`,
    network.transport !== "local",
    options.port,
  );
  const { gateway, origin, directEndpoint } = await exposeServices(
    options,
    home,
    network,
    daemon.origin,
    hub,
  );
  if (network.tailscaleState === "unavailable") {
    // Serve failed after Hub was prepared. Reconfigure only Hub's browser origin;
    // gateway policy/target changes are applied without closing daemon sockets.
    hub = await prepareHub(home, origin, true, options.port);
    await launchGateway(
      home,
      {
        daemonOrigin: daemon.origin,
        hubOrigin: hub,
        webDirectory: loadConfig(home, { env: { CLISBOT_HOME: home } }).webUi?.distDir ?? null,
        origins: [],
      },
      Number(new URL(gateway.origin).port),
    );
  }
  await configureServingAdmission(home, [origin, gateway.origin]);
  const enrollment = await enrollPersonalDaemon(home, hub);
  const hubOffer = await localHubPairingOffer({
    home,
    origin,
    ...(options.label ? { label: options.label } : {}),
  });
  const pairing = await resolveLocalPairingOffer({
    clisbotHome: home,
    devicePairing: true,
    enableRelay: network.transport !== "local",
    direct: { endpoint: directEndpoint, useTls: origin.startsWith("https:") },
    hub: hubOffer,
    ...(options.label ? { label: options.label } : {}),
  });
  if (network.transport !== "relay" && pairing.url) {
    pairing.url = `${origin}/${new URL(pairing.url).hash}`;
    pairing.qr = await renderPairingQr(pairing.url);
  }
  return {
    home,
    daemon: daemon.origin,
    hub,
    hubOffer,
    gateway: gateway.origin,
    origin,
    transport: network.transport,
    tailscaleState: network.tailscaleState,
    networkGuidance: network.networkGuidance,
    enrollment,
    ...pairing,
  };
}

async function configureDaemonRelay(home: string, enabled: boolean): Promise<void> {
  // Adding Hub/web must not disconnect an app already using daemon relay.
  // Explicit daemon config owns disabling an existing transport.
  if (!enabled) return;
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    const config = (await client.getDaemonConfig()).config;
    if (config.relay?.enabled !== enabled) await client.patchDaemonConfig({ relay: { enabled } });
  } finally {
    await client.close();
  }
}

export function outputPersonalServices(
  json: boolean,
  result: PersonalDaemonResult | PersonalServingResult,
): void {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  const hub =
    "hub" in result
      ? `Hub API: ${result.transport === "relay" ? "encrypted relay (separate Hub ingress)" : `${result.origin}/api/management`}\n`
      : "";
  console.log(
    `Daemon: ${result.daemon}\n${hub}Web: ${result.origin}\n\n${result.qr ?? ""}\n${result.url}\n\nInvitation expires in 5 minutes. Prefer Tailscale on your phone for a direct connection.`,
  );
  if (!("hub" in result))
    console.log(
      "Your Host is ready. Start or connect a Hub in the app when you need channels, automations or shared administration.",
    );
  else if (result.enrollment === "account-approval-required")
    console.log(
      "Hub requires account login. Complete protected owner setup when needed, then approve this Host with clisbot hub connect. The daemon retains its own device credential.",
    );
}

async function prepareDaemon(home: string, relay: boolean): Promise<{ origin: string }> {
  const running = await readDaemonInstance(home);
  if (!running && existsSync(path.join(home, "config.json"))) {
    const config = loadConfig(home, { env: { CLISBOT_HOME: home } });
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(config.listen))
      throw new Error(
        "Personal serving requires daemon.listen to be loopback TCP; no daemon was started",
      );
  }
  if (running) {
    const client = await connectToDaemon({ target: { kind: "instance", home } });
    try {
      if (client.getLastServerInfoMessage()?.features?.devicePairing !== true)
        throw new Error(
          "This running daemon predates device pairing. Enable features.devicePairing and restart it when its work can be interrupted; then retry. No running process was restarted.",
        );
    } finally {
      await client.close();
    }
  } else {
    const fresh = !existsSync(path.join(home, "config.json"));
    editPersistedConfig(home, "features.devicePairing", { value: true });
    if (fresh) {
      editPersistedConfig(home, "daemon.managedAccess.mode", { value: "off" });
      editPersistedConfig(home, "daemon.listen", {
        value: `127.0.0.1:${await selectLocalPort(6868, true)}`,
      });
      editPersistedConfig(home, "daemon.relay.enabled", { value: relay });
    }
  }
  const launch = await launchLocalDaemon({ home, timeoutMs: 60_000 });
  const listen = launch.instance.listen;
  if (!listen || !/^(127\.0\.0\.1|localhost):\d+$/.test(listen))
    throw new Error(
      "Personal serving requires a loopback TCP daemon listener; set daemon.listen in its config before launch",
    );
  return { origin: `http://${listen}` };
}

async function servingNetwork(options: PersonalServingOptions): Promise<{
  transport: string;
  origin?: string;
  tailscale?: { dnsName: string; port: number };
  tailscaleState?: "ready" | "missing" | "login-required" | "stopped" | "unavailable";
  networkGuidance?: string;
}> {
  const transport = options.transport ?? "tailscale";
  if (!["tailscale", "relay", "local", "https"].includes(transport))
    throw new Error("Unknown transport; choose tailscale, relay, local or https");
  if (transport === "https") {
    const url = new URL(options.publicUrl ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("--public-url must be an HTTPS origin");
    return { transport, origin: url.origin };
  }
  if (transport !== "tailscale") return { transport };
  const status = await detectTailscale();
  if (status.state === "ready") {
    const httpsPort = port(
      options.httpsPort ??
        String(readTailscaleServePort(selectedHome(options), status.dnsName) ?? 8443),
    );
    return {
      transport,
      tailscale: { dnsName: status.dnsName, port: httpsPort },
      tailscaleState: "ready",
      origin: new URL(`https://${status.dnsName}:${httpsPort}`).origin,
    };
  }
  console.error(status.guidance);
  if (!process.stdin.isTTY || options.json)
    return { transport: "relay", tailscaleState: status.state, networkGuidance: status.guidance };
  const answer = await select({
    message: "Continue after installing/signing in, or choose another connection",
    options: [
      { value: "retry", label: "Retry Tailscale" },
      { value: "relay", label: "Use encrypted relay" },
      { value: "local", label: "Use this machine only" },
    ],
  });
  if (isCancel(answer)) throw new Error("Serving cancelled");
  return answer === "retry"
    ? servingNetwork(options)
    : { transport: answer, tailscaleState: status.state, networkGuidance: status.guidance };
}

function port(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error("Port must be 1–65535");
  return number;
}

async function exposeServices(
  options: PersonalServingOptions,
  home: string,
  network: Awaited<ReturnType<typeof servingNetwork>>,
  daemonOrigin: string,
  hub: string | null,
) {
  const config = loadConfig(home, { env: { CLISBOT_HOME: home } });
  const gateway = await launchGateway(
    home,
    {
      daemonOrigin,
      hubOrigin: hub,
      webDirectory: config.webUi?.distDir ?? null,
      origins: network.origin ? [network.origin] : [],
    },
    port(options.webPort ?? "6880"),
  );
  let origin = network.origin ?? gateway.origin;
  if (network.tailscale) {
    try {
      origin = await configureTailscaleServe({
        home,
        dnsName: network.tailscale.dnsName,
        port: network.tailscale.port,
        target: gateway.origin,
      });
    } catch (error) {
      if (process.stdin.isTTY && !options.json) throw error;
      network.transport = "relay";
      network.tailscaleState = "unavailable";
      network.networkGuidance =
        "Tailscale Serve could not expose this Host. Clisbot is using encrypted relay. Check HTTPS/Serve permissions (an Admin terminal on Windows), then retry. Existing Serve mappings were preserved.";
      delete network.tailscale;
      delete network.origin;
      console.error(network.networkGuidance);
      await launchGateway(
        home,
        {
          daemonOrigin,
          hubOrigin: hub,
          webDirectory: config.webUi?.distDir ?? null,
          origins: [],
        },
        Number(new URL(gateway.origin).port),
      );
      origin = gateway.origin;
    }
  }
  const directEndpoint = `${new URL(origin).hostname}:${new URL(origin).port || (origin.startsWith("https:") ? "443" : "80")}`;
  editPersistedConfig(home, "daemon.direct.endpoint", { value: directEndpoint });
  editPersistedConfig(home, "daemon.direct.useTls", { value: origin.startsWith("https:") });
  editPersistedConfig(home, "features.personalServing", { value: true });
  return { gateway, origin, directEndpoint };
}

import {
  readTransportChoice,
  saveTransportChoice,
  tailscaleSetupError,
} from "./transport-choice.js";
import { prepareFreshPersonalHome } from "./personal-home.js";
import { readWebIntent, updateLocalWebHub } from "./web.js";
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
import {
  configureTailscaleServe,
  readTailscaleServePort,
  selectTailscaleServePort,
} from "./tailscale.js";
import { selectLocalPort } from "../hub/local-port.js";
import { connectToDaemon } from "../../utils/client.js";
import { enrollPersonalDaemon } from "./enrollment.js";
import { withServiceLaunchLock } from "../../utils/service-launch-lock.js";
import { detectTailscale } from "@clisbot/server/gateway-adapters";
import { isProcessRunning, resolveLocalHubState } from "../hub/local-hub.js";

export interface PersonalServingOptions {
  home?: string;
  transport?: string;
  publicUrl?: string;
  httpsPort?: string;
  webPort?: string;
  label?: string;
  json?: boolean;
  port?: string;
  /** Do not enable relay or change the saved route when configuring app access. */
  preserveRelay?: boolean;
}

/** Internal composition behind the existing onboarding and Hub lifecycle commands. */
export async function startPersonalHub(
  options: PersonalServingOptions,
): Promise<PersonalServingResult> {
  const home = selectedHome(options);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const network = await servingNetwork(options, true);
  return withServiceLaunchLock(path.join(home, "serve-launch"), async () => {
    const result = await launchServices(options, home, network);
    saveTransportChoice(home, result.transport);
    return result;
  });
}

export async function startPersonalDaemon(
  options: PersonalServingOptions,
): Promise<PersonalDaemonResult> {
  const home = selectedHome(options);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const network = await servingNetwork(options);
  return withServiceLaunchLock(path.join(home, "serve-launch"), async () => {
    const relay = !options.preserveRelay && network.transport === "relay";
    const daemon = await prepareDaemon(home, relay);
    if (relay) await configureDaemonRelay(home, true);
    const exposed = await exposeServices(
      options,
      home,
      network,
      daemon.origin,
      existingGatewayHub(home),
    );
    await configureServingAdmission(home, servingOrigins(exposed));
    const pairing = await resolveLocalPairingOffer({
      clisbotHome: home,
      devicePairing: true,
      enableRelay: relay,
      direct: exposed.direct,
      ...(options.label ? { label: options.label } : {}),
    });
    if (!options.preserveRelay) saveTransportChoice(home, network.transport);
    return {
      home,
      daemon: daemon.origin,
      gateway: exposed.gateway,
      origin: exposed.origin ?? daemon.origin,
      transport: network.transport,
      tailscaleState: network.tailscaleState,
      networkGuidance: network.networkGuidance,
      ...(network.tailscaleActionUrl ? { tailscaleActionUrl: network.tailscaleActionUrl } : {}),
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
  /** Loopback gateway, or null when no Tailscale or public HTTPS route needs one. */
  gateway: string | null;
  /** The public route, or the loopback service the app reaches without one. */
  origin: string;
  transport: string;
  url: string | null;
  qr: string | null;
  relayEnabled: boolean;
  tailscaleState?: "ready" | "missing" | "login-required" | "stopped" | "unavailable";
  networkGuidance?: string;
  tailscaleActionUrl?: string;
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
  const relay = network.transport === "relay";
  const daemon = await prepareDaemon(home, relay);
  await configureDaemonRelay(home, relay);
  let plan: Awaited<ReturnType<typeof hubLaunchPlan>>;
  try {
    plan = await hubLaunchPlan(options, home, network);
  } catch (error) {
    if (network.tailscale) throw tailscaleSetupError(home, error, true);
    throw error;
  }
  const hubAppOrigin = plan.appOrigin;
  const hub = await prepareHub(home, hubAppOrigin, relay, plan.hubPort);
  // The gateway takes the port the plan reserved, so its origin is the one Hub was given.
  const serving = plan.gatewayPort ? { ...options, webPort: plan.gatewayPort } : options;
  let origin = hubAppOrigin;
  if (network.tailscale && network.transport === "tailscale") {
    const hubServingHome = path.join(home, "hub-serving");
    mkdirSync(hubServingHome, { recursive: true, mode: 0o700 });
    try {
      origin = await mapTailscale(
        { ...options, httpsPort: undefined },
        hubServingHome,
        {
          dnsName: network.tailscale.dnsName,
          port: plan.hubHttpsPort ?? network.tailscale.port + 1,
        },
        hub,
      );
    } catch (error) {
      throw tailscaleSetupError(home, error, true);
    }
  }
  const exposed = await exposeServices(serving, home, network, daemon.origin, hub);
  if (network.transport === "https") origin = exposed.origin ?? hub;
  if (exposed.gateway)
    await launchGateway(
      home,
      gatewayConfig(home, daemon.origin, hub, exposed.origin ? [exposed.origin] : []),
      Number(new URL(exposed.gateway).port),
    );
  // Optional web is a transport, never Hub's OAuth identity or lifecycle owner.
  await updateLocalWebHub(home, hub);
  await configureServingAdmission(home, servingOrigins(exposed));
  const enrollment = await enrollPersonalDaemon(home, hub);
  const hubOffer = await localHubPairingOffer({
    home,
    origin,
    ...(options.label ? { label: options.label } : {}),
  });
  const pairing = await resolveLocalPairingOffer({
    clisbotHome: home,
    devicePairing: true,
    enableRelay: relay,
    direct: exposed.direct,
    hub: hubOffer,
    ...(options.label ? { label: options.label } : {}),
  });
  return {
    home,
    daemon: daemon.origin,
    hub,
    hubOffer,
    gateway: exposed.gateway,
    origin,
    transport: network.transport,
    tailscaleState: network.tailscaleState,
    networkGuidance: network.networkGuidance,
    enrollment,
    ...pairing,
  };
}

/** Hub's own address when no gateway fronts it: the running or saved port, else a free one. */
async function hubLoopbackOrigin(home: string, hubPort?: string): Promise<string> {
  const saved = resolveLocalHubState({ home }).state?.port;
  const selected = hubPort ? Number(hubPort) : (saved ?? (await selectLocalPort(6870, true)));
  return `http://127.0.0.1:${selected}`;
}

/**
 * Where the app will reach Hub, decided before Hub starts: the public route, the gateway that
 * serves the web UI, or Hub's own loopback port. Only the last one picks Hub's port.
 */
async function hubLaunchPlan(
  options: PersonalServingOptions,
  home: string,
  network: Awaited<ReturnType<typeof servingNetwork>>,
): Promise<{
  appOrigin: string;
  hubPort: string | undefined;
  gatewayPort?: string;
  hubHttpsPort?: number;
}> {
  const existing = resolveLocalHubState({ home }).state;
  const loopback = await hubLoopbackOrigin(home, options.port);
  let hubHttpsPort: number | undefined;
  if (network.tailscale) {
    const servingHome = path.join(home, "hub-serving");
    mkdirSync(servingHome, { recursive: true, mode: 0o700 });
    hubHttpsPort = await selectTailscaleServePort({
      home: servingHome,
      dnsName: network.tailscale.dnsName,
      preferred:
        readTailscaleServePort(servingHome, network.tailscale.dnsName) ??
        network.tailscale.port + 1,
      fixed: false,
      target: loopback,
    });
  }
  let freshOrigin = loopback;
  if (hubHttpsPort && network.tailscale)
    freshOrigin = new URL(`https://${network.tailscale.dnsName}:${hubHttpsPort}`).origin;
  else if (network.transport === "https") freshOrigin = network.origin!;
  const appOrigin = existing?.appOrigin ?? freshOrigin;
  return { appOrigin, hubPort: new URL(loopback).port, ...(hubHttpsPort ? { hubHttpsPort } : {}) };
}

/** The gateway this home is running, if any; a repeat start reuses its port and web files. */
function runningGateway(home: string): { origin: string; webDirectory: string | null } | null {
  try {
    const state = JSON.parse(readFileSync(path.join(home, "gateway-local.json"), "utf8")) as {
      pid?: number;
      config?: { port?: number; webDirectory?: string | null };
    };
    if (!state.pid || !state.config?.port || !isProcessRunning(state.pid)) return null;
    return {
      origin: `http://127.0.0.1:${state.config.port}`,
      webDirectory: state.config.webDirectory ?? null,
    };
  } catch {
    return null;
  }
}

function servingOrigins(exposed: { gateway: string | null; origin: string | null }): string[] {
  return [exposed.origin, exposed.gateway].filter((origin): origin is string => Boolean(origin));
}

/** The web UI directory when the person turned the web UI on (config or `CLISBOT_WEB_UI_ENABLED`). */
function enabledWebDirectory(home: string): string | null {
  const intent = readWebIntent(home);
  if (intent?.enabled) return intent.directory;
  const webUi = loadConfig(home, { env: { ...process.env, CLISBOT_HOME: home } }).webUi;
  return webUi?.enabled ? (webUi.distDir ?? null) : null;
}

/**
 * The gateway forwards daemon and Hub routes; it serves the web UI only when that is on. A
 * gateway already running keeps the web files it started with, so an upgrade does not restart
 * it and drop the sockets it carries; the rule applies from its next start.
 */
function gatewayConfig(
  home: string,
  daemonOrigin: string,
  hubOrigin: string | null,
  origins: string[],
) {
  const webDirectory = enabledWebDirectory(home) ?? runningGateway(home)?.webDirectory ?? null;
  return { daemonOrigin, hubOrigin, webDirectory, origins };
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
    `Daemon: ${result.daemon}\n${hub}${result.gateway ? `Address: ${result.origin}\n` : ""}\n${result.qr ?? ""}\n${result.url}\n\nInvitation expires in 5 minutes. Prefer Tailscale on your phone for a direct connection.`,
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
    await prepareFreshPersonalHome(home, { relay });
    editPersistedConfig(home, "features.devicePairing", { value: true });
  }
  const launch = await launchLocalDaemon({ home, timeoutMs: 60_000 });
  const listen = launch.instance.listen;
  if (!listen || !/^(127\.0\.0\.1|localhost):\d+$/.test(listen))
    throw new Error(
      "Personal serving requires a loopback TCP daemon listener; set daemon.listen in its config before launch",
    );
  return { origin: `http://${listen}` };
}

async function servingNetwork(
  options: PersonalServingOptions,
  hub = false,
): Promise<{
  transport: string;
  origin?: string;
  tailscale?: { dnsName: string; port: number };
  tailscaleState?: "ready" | "missing" | "login-required" | "stopped" | "unavailable";
  networkGuidance?: string;
  tailscaleActionUrl?: string;
}> {
  const transport = options.transport ?? readTransportChoice(selectedHome(options)) ?? "tailscale";
  if (!["tailscale", "relay", "local", "https"].includes(transport))
    throw new Error("Unknown transport; choose tailscale, relay, local or https");
  if (transport === "https") return { transport, origin: publicHttpsOrigin(options.publicUrl) };
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
  const failure = tailscaleSetupError(selectedHome(options), new Error(status.guidance), hub);
  if (!process.stdin.isTTY || options.json) throw failure;
  console.error(failure.message);
  const answer = await select({
    message: "Continue after installing/signing in, or choose another connection",
    options: [
      { value: "retry", label: "Retry Tailscale" },
      { value: "relay", label: "Use Clisbot hosted relay (end-to-end encrypted; currently free)" },
      { value: "local", label: "Use this machine only" },
    ],
  });
  if (isCancel(answer)) throw new Error("Serving cancelled");
  return answer === "retry"
    ? servingNetwork(options, hub)
    : { transport: answer, tailscaleState: status.state, networkGuidance: status.guidance };
}

function publicHttpsOrigin(value: string | undefined): string {
  const url = new URL(value ?? "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("--public-url must be an HTTPS origin");
  return url.origin;
}

function port(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error("Port must be 1–65535");
  return number;
}

interface ExposedServices {
  gateway: string | null;
  /** Tailscale or public HTTPS origin; null when the app connects by relay or loopback. */
  origin: string | null;
  direct: { endpoint: string; useTls: boolean };
}

async function exposeServices(
  options: PersonalServingOptions,
  home: string,
  network: Awaited<ReturnType<typeof servingNetwork>>,
  daemonOrigin: string,
  hub: string | null,
): Promise<ExposedServices> {
  const loopback = { endpoint: new URL(daemonOrigin).host, useTls: false };
  // A gateway fronts a public route, or the self-hosted web UI the person turned on.
  if (network.transport !== "https") {
    if (network.tailscale) {
      try {
        const origin = await mapTailscale(options, home, network.tailscale, daemonOrigin);
        const url = new URL(origin);
        return persistDirect(home, null, origin, {
          endpoint: url.host,
          useTls: true,
        });
      } catch (error) {
        throw tailscaleSetupError(home, error, hub !== null);
      }
    }
    return persistDirect(home, null, null, loopback);
  }
  const gateway = await launchGateway(
    home,
    gatewayConfig(home, daemonOrigin, hub, network.origin ? [network.origin] : []),
    port(options.webPort ?? "6880"),
  );
  const origin = network.origin;
  if (!origin) return persistDirect(home, gateway.origin, null, loopback);
  const url = new URL(origin);
  const direct = {
    endpoint: `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`,
    useTls: url.protocol === "https:",
  };
  return persistDirect(home, gateway.origin, origin, direct);
}

/** Maps the preferred HTTPS port, or the next free one unless the person chose the port. */
async function mapTailscale(
  options: PersonalServingOptions,
  home: string,
  tailscale: { dnsName: string; port: number },
  target: string,
): Promise<string> {
  tailscale.port = await selectTailscaleServePort({
    home,
    dnsName: tailscale.dnsName,
    preferred: tailscale.port,
    fixed: options.httpsPort !== undefined,
    target,
  });
  return configureTailscaleServe({
    home,
    dnsName: tailscale.dnsName,
    port: tailscale.port,
    target,
  });
}

function persistDirect(
  home: string,
  gateway: string | null,
  origin: string | null,
  direct: { endpoint: string; useTls: boolean },
): ExposedServices {
  editPersistedConfig(home, "daemon.direct.endpoint", { value: direct.endpoint });
  editPersistedConfig(home, "daemon.direct.useTls", { value: direct.useTls });
  editPersistedConfig(home, "features.personalServing", { value: true });
  return { gateway, origin, direct };
}

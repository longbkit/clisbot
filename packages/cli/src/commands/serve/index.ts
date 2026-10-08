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
import { launchGateway, stopGateway } from "./gateway-launch.js";
import {
  configureTailscaleServe,
  readTailscaleServePort,
  selectTailscaleServePort,
} from "./tailscale.js";
import { selectLocalPort } from "../hub/local-port.js";
import { connectToDaemon } from "../../utils/client.js";
import { enrollPersonalDaemon } from "./enrollment.js";
import { withServiceLaunchLock } from "../../utils/service-launch-lock.js";
import { detectTailscale, tailscaleApprovalUrl } from "@clisbot/server/gateway-adapters";
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
  /** Leave relay as configured; `onboard` turns it on as a fallback, the app's setup does not. */
  preserveRelay?: boolean;
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
    const relay = !options.preserveRelay && network.transport !== "local";
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
  const relay = network.transport !== "local";
  const daemon = await prepareDaemon(home, relay);
  await configureDaemonRelay(home, relay);
  const plan = await hubLaunchPlan(options, home, network);
  const hubAppOrigin = plan.appOrigin;
  let hub = await prepareHub(home, hubAppOrigin, relay, plan.hubPort);
  // The gateway takes the port the plan reserved, so its origin is the one Hub was given.
  const serving = plan.gatewayPort ? { ...options, webPort: plan.gatewayPort } : options;
  const exposed = await exposeServices(serving, home, network, daemon.origin, hub);
  // Without a public route the app reaches Hub on its own loopback port.
  const origin = exposed.origin ?? hub;
  if (origin !== hubAppOrigin) {
    // The public route changed or failed after Hub was prepared. Reconfigure only Hub's
    // browser origin; gateway targets change without closing daemon sockets.
    hub = await prepareHub(home, origin, relay, new URL(hub).port);
    if (exposed.gateway)
      await launchGateway(
        home,
        gatewayConfig(home, daemon.origin, hub, exposed.origin ? [exposed.origin] : []),
        Number(new URL(exposed.gateway).port),
      );
  }
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
): Promise<{ appOrigin: string; hubPort: string | undefined; gatewayPort?: string }> {
  if (network.origin) return { appOrigin: network.origin, hubPort: options.port };
  if (enabledWebDirectory(home)) {
    const running = runningGateway(home)?.origin;
    if (running) return { appOrigin: running, hubPort: options.port };
    const gatewayPort = String(await selectLocalPort(port(options.webPort ?? "6880"), true));
    return { appOrigin: `http://127.0.0.1:${gatewayPort}`, hubPort: options.port, gatewayPort };
  }
  const appOrigin = await hubLoopbackOrigin(home, options.port);
  return { appOrigin, hubPort: new URL(appOrigin).port };
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
  tailscaleActionUrl?: string;
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
  const webUi = enabledWebDirectory(home) !== null;
  if (!network.origin && !webUi) return persistDirect(options, home, network, null, null, loopback);
  let gateway = await launchGateway(
    home,
    gatewayConfig(home, daemonOrigin, hub, network.origin ? [network.origin] : []),
    port(options.webPort ?? "6880"),
  );
  if (network.tailscale) {
    try {
      network.origin = await mapTailscale(options, home, network.tailscale, gateway.origin);
      gateway = await launchGateway(
        home,
        gatewayConfig(home, daemonOrigin, hub, [network.origin]),
        Number(new URL(gateway.origin).port),
      );
    } catch (error) {
      if (process.stdin.isTTY && !options.json) throw error;
      fallBackToRelay(options, network, error);
      if (!gateway.reused && !webUi) {
        await stopGateway(home);
        return persistDirect(options, home, network, null, null, loopback);
      }
      await launchGateway(
        home,
        gatewayConfig(home, daemonOrigin, hub, []),
        Number(new URL(gateway.origin).port),
      );
    }
  }
  const origin = network.origin ?? (webUi ? gateway.origin : null);
  if (!origin) return persistDirect(options, home, network, gateway.origin, null, loopback);
  const url = new URL(origin);
  const direct = {
    endpoint: `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`,
    useTls: url.protocol === "https:",
  };
  return persistDirect(options, home, network, gateway.origin, origin, direct);
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

function fallBackToRelay(
  options: PersonalServingOptions,
  network: Awaited<ReturnType<typeof servingNetwork>>,
  error: unknown,
): void {
  network.transport = "relay";
  network.tailscaleState = "unavailable";
  network.tailscaleActionUrl = tailscaleApprovalUrl(error);
  const reason = tailscaleFailureReason(error);
  network.networkGuidance = `Tailscale Serve could not expose this Host (${reason}).${options.preserveRelay ? "" : " Clisbot is using encrypted relay."} ${network.tailscaleActionUrl ? "Enable Serve on your tailnet, then retry." : "Fix this, then retry (on Windows, Serve needs an Admin terminal)."}`;
  delete network.tailscale;
  delete network.origin;
  console.error(network.networkGuidance);
}

/** Tailscale's own words (its stderr) rather than the whole failed command line. */
function tailscaleFailureReason(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

function persistDirect(
  options: PersonalServingOptions,
  home: string,
  network: Awaited<ReturnType<typeof servingNetwork>>,
  gateway: string | null,
  origin: string | null,
  direct: { endpoint: string; useTls: boolean },
): ExposedServices {
  // The app's Set up Tailscale must not swap the saved route for a loopback one when Serve
  // fails; `onboard` keeps its fallback to this machine's daemon.
  if (options.preserveRelay && network.tailscaleState === "unavailable")
    return { gateway, origin, direct };
  editPersistedConfig(home, "daemon.direct.endpoint", { value: direct.endpoint });
  editPersistedConfig(home, "daemon.direct.useTls", { value: direct.useTls });
  editPersistedConfig(home, "features.personalServing", { value: true });
  return { gateway, origin, direct };
}

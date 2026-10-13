const WEB_PROTECTION_REQUIRED =
  "Local web was not exposed: this existing Host does not use protected device pairing. Stop any web gateway from an older version with clisbot web stop. Enable features.devicePairing during planned Host maintenance and restart the Host when safe, then run clisbot web start again. Existing policy and running process were preserved.";
import { prepareFreshPersonalHome } from "./personal-home.js";
import { connectToDaemon } from "../../utils/client.js";
import { homeRequiresTickets } from "@clisbot/server/hub-membership";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  loadConfig,
  readPersistedConfig,
  resolveConfigFromPersisted,
} from "@clisbot/server/configuration";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import { resolveLocalHubState, isProcessRunning } from "../hub/local-hub.js";
import { launchLocalDaemon } from "../daemon/local-daemon.js";
import { launchGateway, stopGateway } from "./gateway-launch.js";
import { configureServingAdmission } from "./network-admission.js";
import { readTailscaleServeHandler, detectTailscale } from "@clisbot/server/gateway-adapters";
import {
  configureTailscaleServe,
  selectTailscaleServePort,
  removeTailscaleServe,
} from "./tailscale.js";
import { writeServiceFile } from "../../utils/service-files.js";

interface WebIntent {
  enabled: boolean;
  directory: string;
  port: number;
}
export function readWebIntent(home: string): WebIntent | null {
  try {
    const value = JSON.parse(readFileSync(path.join(home, "web-intent.json"), "utf8"));
    if (
      typeof value.enabled !== "boolean" ||
      typeof value.directory !== "string" ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/** Web owns the gateway only. It never creates Hub or changes Hub's issuer. */
export async function startLocalWeb(home: string, preferredPort?: number) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  await prepareFreshPersonalHome(home, { relay: false });
  const saved = readWebIntent(home);
  const config = loadConfig(home, { env: { ...process.env, CLISBOT_HOME: home } });
  if (!config.devicePairingEnabled && !(await readDaemonInstance(home)))
    throw new Error(WEB_PROTECTION_REQUIRED);
  const directory = saved?.directory ?? config.webUi?.distDir;
  if (!directory) throw new Error("This package does not provide a bundled web UI");
  await ensureWebAssets(directory);
  const port = preferredPort ?? saved?.port ?? 6880;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Web port must be 1–65535");
  const daemonOrigin = await protectedWebDaemonOrigin(home);
  const hub = resolveLocalHubState({ home });
  let gateway = await launchGateway(
    home,
    {
      daemonOrigin,
      hubOrigin: hub.running ? hub.state!.url : null,
      webDirectory: directory,
      origins: [],
    },
    port,
  );
  const privateWeb = await configurePrivateWeb(
    home,
    {
      daemonOrigin,
      hubOrigin: hub.running ? hub.state!.url : null,
      webDirectory: directory,
      origins: [],
    },
    gateway,
  );
  gateway = privateWeb.gateway;
  const { tailscaleUrl, tailscaleState, networkGuidance } = privateWeb;
  const origins = [gateway.origin, ...(tailscaleUrl ? [tailscaleUrl] : [])];
  writeServiceFile(path.join(home, "web-origins.json"), origins);
  writeServiceFile(path.join(home, "web-intent.json"), {
    enabled: true,
    directory,
    port: Number(new URL(gateway.origin).port),
    tailscaleState,
    networkGuidance,
  });
  await configureServingAdmission(home, origins);
  return {
    ...gateway,
    tailscaleUrl,
    tailscaleState,
    networkGuidance,
    access: webAccess(home),
    running: true,
    enabled: true,
    home,
    hub: hub.running ? hub.state!.url : null,
    autostart: "Restored by Clisbot serving lifecycle; reboot requires an installed OS service",
  };
}

export async function updateLocalWebHub(home: string, hubOrigin: string | null): Promise<void> {
  const web = await localWebStatus(home);
  if (!web.running) return;
  const state = JSON.parse(readFileSync(path.join(home, "gateway-local.json"), "utf8"));
  const {
    instanceId: _instanceId,
    port: _port,
    controlToken: _controlToken,
    ...config
  } = state.config;
  await launchGateway(home, { ...config, hubOrigin }, state.config.port);
}

export async function localWebStatus(home: string) {
  const intent = readWebIntent(home);
  try {
    const state = JSON.parse(readFileSync(path.join(home, "gateway-local.json"), "utf8"));
    let running = false;
    if (isProcessRunning(state.pid)) {
      const response = await fetch(`http://127.0.0.1:${state.config.port}/api/gateway/health`, {
        signal: AbortSignal.timeout(500),
      });
      const identity = z.object({ instanceId: z.string() }).safeParse(await response.json());
      running =
        response.ok && identity.success && identity.data.instanceId === state.config.instanceId;
    }
    const origin = running ? `http://127.0.0.1:${state.config.port}` : null;
    const network = origin
      ? await currentWebNetwork(origin, state.config.origins?.[0])
      : {
          tailscaleUrl: null,
          tailscaleState: "unavailable",
          networkGuidance: "Run clisbot web start to enable local web.",
        };
    return {
      home,
      enabled: intent?.enabled === true,
      running,
      origin,
      ...network,
      access: webAccess(home),
      pid: state.pid,
    };
  } catch {
    return {
      home,
      enabled: intent?.enabled === true,
      running: false,
      origin: null,
      tailscaleUrl: null,
      tailscaleState: "unavailable",
      networkGuidance: "Run clisbot web start to enable local web.",
      access: webAccess(home),
      pid: null,
    };
  }
}

export async function stopLocalWeb(home: string) {
  const saved = readWebIntent(home);
  writeServiceFile(path.join(home, "web-origins.json"), []);
  if (saved) writeServiceFile(path.join(home, "web-intent.json"), { ...saved, enabled: false });
  await removeTailscaleServe(path.join(home, "web-serving"));
  await stopGateway(home);
  return localWebStatus(home);
}

export async function restoreLocalWeb(home: string): Promise<void> {
  if (readWebIntent(home)?.enabled && (await readDaemonInstance(home))) await startLocalWeb(home);
}

async function ensureWebAssets(directory: string): Promise<void> {
  if (!existsSync(path.join(directory, "index.html"))) {
    const script = fileURLToPath(
      new URL("../../../../../scripts/build-daemon-web-ui.mjs", import.meta.url),
    );
    if (!existsSync(script))
      throw new Error(
        "This Clisbot package is missing its bundled web UI. Update to a complete matching package.",
      );
    console.error("Preparing the bundled local web UI…");
    await promisify(execFile)(process.execPath, [script], {
      cwd: path.dirname(path.dirname(script)),
      timeout: 240_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!existsSync(path.join(directory, "index.html")))
      throw new Error("The bundled web UI could not be prepared");
  }
}

function webAccess(home: string): "owner-pairing" | "hub-ticket" | "setup-required" {
  const config = resolveConfigFromPersisted(
    home,
    readPersistedConfig(home, { defaultsIfMissing: true }),
    { env: { ...process.env, CLISBOT_HOME: home } },
  );
  if (!config.devicePairingEnabled) return "setup-required";
  return config.managedAccessMode === "external" && homeRequiresTickets(home)
    ? "hub-ticket"
    : "owner-pairing";
}
function webNetworkGuidance(state: string): string {
  if (state === "missing")
    return "Use the local URL. Install and sign in to Tailscale on this Host for private access, then run clisbot web start again.";
  if (state === "login-required")
    return "Use the local URL. Sign in to Tailscale on this Host, then run clisbot web start again.";
  if (state === "stopped")
    return "Use the local URL. Start Tailscale on this Host, then run clisbot web start again.";
  return "Use the local URL. Check Tailscale on this Host, then run clisbot web start again.";
}

async function currentWebNetwork(origin: string, configured?: string) {
  const network = await detectTailscale();
  if (network.state !== "ready")
    return {
      tailscaleUrl: null,
      tailscaleState: network.state,
      networkGuidance: webNetworkGuidance(network.state),
    };
  try {
    if (
      configured &&
      new URL(configured).hostname === network.dnsName &&
      (await readTailscaleServeHandler(new URL(configured).host))?.proxy === origin
    )
      return {
        tailscaleUrl: configured,
        tailscaleState: "ready",
        networkGuidance:
          "Private URL is available to devices allowed by your tailnet; Host authentication is still required.",
      };
  } catch {
    /* A stale/missing map is not a usable private URL. */
  }
  return {
    tailscaleUrl: null,
    tailscaleState: "unavailable",
    networkGuidance:
      "Private web mapping is missing or changed. Run clisbot web start to check and restore this home's mapping.",
  };
}

async function protectedWebDaemonOrigin(home: string): Promise<string> {
  const daemon = await launchLocalDaemon({ home });
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    if (client.getLastServerInfoMessage()?.features?.devicePairing !== true)
      throw new Error(WEB_PROTECTION_REQUIRED);
  } finally {
    await client.close();
  }
  if (!daemon.instance.listen || !/^(127\.0\.0\.1|localhost):\d+$/.test(daemon.instance.listen))
    throw new Error(
      "Local web requires this Host's loopback TCP listener. Existing daemon was preserved.",
    );
  return `http://${daemon.instance.listen}`;
}

async function configurePrivateWeb(
  home: string,
  config: Parameters<typeof launchGateway>[1],
  gateway: Awaited<ReturnType<typeof launchGateway>>,
) {
  let nextGateway = gateway;
  let tailscaleUrl: string | null = null;
  const network = await detectTailscale();
  let tailscaleState: string = network.state;
  let networkGuidance =
    network.state === "ready"
      ? "Private URL is available to devices allowed by your tailnet; Host authentication is still required."
      : webNetworkGuidance(network.state);
  if (network.state === "ready") {
    const servingHome = path.join(home, "web-serving");
    mkdirSync(servingHome, { recursive: true, mode: 0o700 });
    try {
      const httpsPort = await selectTailscaleServePort({
        home: servingHome,
        dnsName: network.dnsName,
        preferred: 8445,
        fixed: false,
        target: nextGateway.origin,
      });
      tailscaleUrl = await configureTailscaleServe({
        home: servingHome,
        dnsName: network.dnsName,
        port: httpsPort,
        target: nextGateway.origin,
      });
      nextGateway = await launchGateway(
        home,
        { ...config, origins: [tailscaleUrl] },
        Number(new URL(nextGateway.origin).port),
      );
    } catch (error) {
      tailscaleUrl = null;
      tailscaleState = "unavailable";
      networkGuidance = `Use the local URL. Tailscale Serve could not expose this web UI: ${error instanceof Error ? error.message : String(error)}. Fix Serve availability, then run clisbot web start again.`;
      console.error(
        `Local web is available on loopback. Tailscale: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { gateway: nextGateway, tailscaleUrl, tailscaleState, networkGuidance };
}

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedHostDaemon, getAvailableHostDaemonPort } from "./isolated-host-daemon";
import { killProcessTree } from "./spawn-node";
import { connectDaemonClient } from "./daemon-client-loader";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";

/** Actual local Worker relay + actual daemon; no installed providers or Owner homes. */
export async function startAdmissionRouteFixture() {
  const root = path.resolve(__dirname, "../../../../..");
  const require = createRequire(path.join(root, "packages/app/package.json"));
  const wranglerCli = path.join(
    path.dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
  const relayPort = await getAvailableHostDaemonPort();
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-admission-routes-"));
  const providerHome = path.join(home, "providers");
  await mkdir(providerHome);
  const providerIds = ["claude", "codex", "copilot", "opencode", "pi", "omp"];
  await writeFile(
    path.join(home, "config.json"),
    JSON.stringify({
      version: 1,
      agents: { providers: Object.fromEntries(providerIds.map((id) => [id, { enabled: false }])) },
    }),
  );
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    HOME: providerHome,
    USERPROFILE: providerHome,
    CODEX_HOME: path.join(providerHome, ".codex"),
    CLAUDE_CONFIG_DIR: path.join(providerHome, ".claude"),
    PI_CODING_AGENT_DIR: path.join(providerHome, ".pi"),
    PI_CODING_AGENT_SESSION_DIR: path.join(providerHome, ".pi", "sessions"),
    XDG_CONFIG_HOME: path.join(providerHome, ".config"),
    XDG_DATA_HOME: path.join(providerHome, ".local", "share"),
    CLISBOT_TAILSCALE_BIN: process.execPath,
  };
  const relay = spawn(
    process.execPath,
    [
      wranglerCli,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(relayPort),
      "--live-reload=false",
      "--show-interactive-dev-session=false",
      "--persist-to",
      path.join(home, "relay-state"),
    ],
    {
      cwd: path.join(root, "packages/relay"),
      env: { ...process.env, ...environment, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let relayLog = "";
  relay.stdout?.on("data", (chunk) => {
    relayLog += chunk.toString();
  });
  relay.stderr?.on("data", (chunk) => {
    relayLog += chunk.toString();
  });
  let daemon: Awaited<ReturnType<typeof startIsolatedHostDaemon>> | undefined;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (relay.exitCode !== null) throw new Error(`Local relay exited: ${relayLog}`);
      try {
        await fetch(`http://127.0.0.1:${relayPort}/health`, { signal: AbortSignal.timeout(500) });
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!ready) throw new Error(`Local relay not ready: ${relayLog}`);
    daemon = await startIsolatedHostDaemon(`admission-routes-${relayPort}`, {
      clisbotHome: home,
      preserveHome: true,
      environment,
      mutableRelay: { enabled: true, endpoint: `127.0.0.1:${relayPort}` },
    });
    const client = await connectDaemonClient<DaemonClient>({
      port: daemon.port,
      clientIdPrefix: "admission-provider-proof",
    });
    let providers;
    try {
      providers = (await client.getProvidersSnapshot()).entries
        .filter(({ provider }) => providerIds.includes(provider))
        .map(({ provider, enabled, status }) => ({ provider, enabled, status }));
    } finally {
      await client.close();
    }
    if (
      providers.length !== 6 ||
      providers.some(({ enabled, status }) => enabled || status !== "unavailable")
    )
      throw new Error("Fixture providers are not effectively disabled");
    const publicKey = JSON.parse(await readFile(path.join(home, "daemon-keypair.json"), "utf8"))
      .publicKeyB64 as string;
    return {
      daemon,
      relayPort,
      publicKey,
      providers,
      close: async () => {
        await daemon?.close();
        await killProcessTree(relay);
        await rm(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await daemon?.close();
    await killProcessTree(relay);
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

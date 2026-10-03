import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "@clisbot/server/configuration";
import { resolveLocalHubState, startLocalHubDetached, stopLocalHub } from "../hub/local-hub.js";

export async function prepareHub(
  home: string,
  appOrigin: string,
  relay: boolean,
  port?: string,
): Promise<string> {
  const existing = resolveLocalHubState({ home });
  if (existing.running && existing.state) {
    const unchanged =
      !existing.state.personalComposition ||
      (existing.state.appOrigin === appOrigin && Boolean(existing.state.deviceRelay) === relay);
    if (unchanged) {
      await requireProtectedHub(existing.state.url);
      return existing.state.url;
    }
    if (!existing.state.controlFile)
      throw new Error(
        "Update the local Hub's serving configuration and restart only Hub, then retry; daemon was preserved",
      );
    console.error(
      "Serving route changed: reconfiguring the personal Hub; daemon continues running.",
    );
    await stopLocalHub({ home });
  }
  const config = loadConfig(home, { env: { CLISBOT_HOME: home } });
  const dataDirectory =
    existing.state?.dataDirectory ??
    process.env.CLISBOT_HUB_DATA_DIR ??
    (existsSync(path.join(home, "PG_VERSION")) ? home : path.join(home, "hub"));
  const started = await startLocalHubDetached(
    {
      home,
      ...(port ? { port } : {}),
      initMasterKey: !existsSync(path.join(dataDirectory, "PG_VERSION")),
      personal: true,
      supervise: true,
    },
    undefined,
    {
      ...process.env,
      CLISBOT_HUB_DATA_DIR: dataDirectory,
      CLISBOT_HUB_APP_URL: appOrigin,
      CLISBOT_HUB_DEVICE_RELAY_ENDPOINT: relay ? config.relayPublicEndpoint : "",
      CLISBOT_HUB_DEVICE_RELAY_TLS: String(config.relayPublicUseTls),
    },
  );
  await waitForHubReady(started.url);
  return started.url;
}

async function requireProtectedHub(origin: string): Promise<void> {
  const response = await fetch(new URL("/api/auth/clisbot/device/identity", origin), {
    signal: AbortSignal.timeout(5_000),
  });
  const identity = (await response.json().catch(() => null)) as { devicePairing?: boolean } | null;
  if (!response.ok || identity?.devicePairing !== true)
    throw new Error(
      "Existing Hub must enable device pairing before remote serving. Restart only Hub when safe; no gateway or public mapping was created.",
    );
}

async function waitForHubReady(origin: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/auth/clisbot/device/identity", origin), {
        signal: AbortSignal.timeout(2_000),
      });
      if (
        response.ok &&
        ((await response.json()) as { devicePairing?: unknown }).devicePairing === true
      )
        return;
    } catch {
      /* Embedded database migrations must finish before pairing. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Hub did not become ready; inspect hub.log in the selected home");
}

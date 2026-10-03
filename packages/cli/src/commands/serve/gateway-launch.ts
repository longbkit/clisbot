import { withServiceLaunchLock } from "../../utils/service-launch-lock.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { selectLocalPort } from "../hub/local-port.js";
import { isProcessRunning } from "../hub/local-hub.js";
import { serviceSupervisorArguments } from "./service-process.js";
import type { GatewayConfig } from "./gateway.js";
import { writeServiceFile } from "../../utils/service-files.js";
import { requestServiceShutdown } from "./service-control.js";

interface GatewayState {
  pid: number;
  config: GatewayConfig;
  controlFile?: string;
}

export async function launchGateway(
  home: string,
  config: Omit<GatewayConfig, "instanceId" | "port">,
  preferredPort = 6880,
) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return withServiceLaunchLock(path.join(home, "gateway-launch"), () =>
    launchGatewayUnlocked(home, config, preferredPort),
  );
}

async function launchGatewayUnlocked(
  home: string,
  config: Omit<GatewayConfig, "instanceId" | "port">,
  preferredPort = 6880,
): Promise<{ origin: string; pid: number; reused: boolean }> {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const statePath = path.join(home, "gateway-local.json");
  let selectedPort = preferredPort;
  if (existsSync(statePath)) {
    const previous = JSON.parse(readFileSync(statePath, "utf8")) as GatewayState;
    if (isProcessRunning(previous.pid)) {
      const current = {
        ...previous.config,
        port: undefined,
        instanceId: undefined,
        controlToken: undefined,
      };
      if (JSON.stringify(current) !== JSON.stringify({ ...config, controlToken: undefined })) {
        if (
          previous.config.controlToken &&
          JSON.stringify({ ...current, hubOrigin: undefined, origins: undefined }) ===
            JSON.stringify({
              ...config,
              hubOrigin: undefined,
              origins: undefined,
              controlToken: undefined,
            })
        ) {
          return updateGatewayTargets(home, previous, config);
        }
        if (!previous.controlFile)
          throw new Error(
            "Gateway configuration changed; stop only the gateway with `clisbot hub stop --web`, then retry",
          );
        await stopGatewayUnlocked(home);
        selectedPort = previous.config.port;
      } else {
        await waitForGateway(previous.config.port, previous.config.instanceId);
        return {
          origin: `http://127.0.0.1:${previous.config.port}`,
          pid: previous.pid,
          reused: true,
        };
      }
    }
  }
  const port = await selectLocalPort(selectedPort, true);
  const next: GatewayConfig = {
    ...config,
    port,
    instanceId: randomUUID(),
    controlToken: randomBytes(32).toString("base64url"),
  };
  const configPath = path.join(home, "gateway-config.json");
  writeServiceFile(configPath, next);
  const controlFile = path.join(home, "gateway-control.json");
  const child = startGatewaySupervisor(home, configPath, controlFile);
  writeServiceFile(statePath, { pid: child.pid!, config: next, controlFile });
  try {
    await waitForGateway(port, next.instanceId);
  } catch (error) {
    await requestServiceShutdown(controlFile, child.pid!).catch(() => undefined);
    throw error;
  }
  return { origin: `http://127.0.0.1:${port}`, pid: child.pid!, reused: false };
}

async function updateGatewayTargets(
  home: string,
  previous: GatewayState,
  config: Omit<GatewayConfig, "instanceId" | "port">,
): Promise<{ origin: string; pid: number; reused: boolean }> {
  const statePath = path.join(home, "gateway-local.json");
  await waitForGateway(previous.config.port, previous.config.instanceId);
  const response = await fetch(`http://127.0.0.1:${previous.config.port}/api/gateway/targets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${previous.config.controlToken}`,
    },
    body: JSON.stringify({ hubOrigin: config.hubOrigin, origins: config.origins }),
    signal: AbortSignal.timeout(5_000),
  });
  const result = (await response.json()) as {
    instanceId?: string;
    hubOrigin?: string | null;
    origins?: string[];
  };
  if (
    !response.ok ||
    result.instanceId !== previous.config.instanceId ||
    result.hubOrigin !== config.hubOrigin ||
    JSON.stringify(result.origins) !== JSON.stringify(config.origins)
  )
    throw new Error("Gateway could not add Hub routing; daemon and its connections were preserved");
  const next = { ...previous.config, hubOrigin: config.hubOrigin, origins: config.origins };
  writeServiceFile(path.join(home, "gateway-config.json"), next);
  writeServiceFile(statePath, { ...previous, config: next });
  return { origin: `http://127.0.0.1:${next.port}`, pid: previous.pid, reused: true };
}

async function waitForGateway(port: number, instanceId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/gateway/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (((await response.json()) as { instanceId?: unknown }).instanceId === instanceId) return;
    } catch {
      /* A newly spawned listener is not ready yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Gateway did not become ready; inspect gateway.log in the selected home");
}

export async function stopGateway(home: string): Promise<void> {
  if (!existsSync(home)) return;
  await withServiceLaunchLock(path.join(home, "gateway-launch"), () => stopGatewayUnlocked(home));
}

async function stopGatewayUnlocked(home: string): Promise<void> {
  const statePath = path.join(home, "gateway-local.json");
  if (!existsSync(statePath)) return;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as GatewayState;
  if (!isProcessRunning(state.pid)) return;
  if (state.controlFile) await requestServiceShutdown(state.controlFile, state.pid);
  else {
    await waitForGateway(state.config.port, state.config.instanceId);
    process.kill(state.pid, "SIGTERM");
  }
  const deadline = Date.now() + 15_000;
  while (isProcessRunning(state.pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (isProcessRunning(state.pid))
    throw new Error("Gateway shutdown is pending; daemon and Hub were preserved");
}

function startGatewaySupervisor(home: string, configPath: string, controlFile: string) {
  const built = fileURLToPath(new URL("./gateway-entry.js", import.meta.url));
  const entry = existsSync(built)
    ? built
    : fileURLToPath(new URL("./gateway-entry.ts", import.meta.url));
  const fd = openSync(path.join(home, "gateway.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    serviceSupervisorArguments(entry, [configPath], controlFile),
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  child.unref();
  if (!child.pid) throw new Error("Gateway supervisor did not start");
  child.on("error", () => undefined);
  return child;
}

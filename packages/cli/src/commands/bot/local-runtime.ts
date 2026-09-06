import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { loadConfig } from "@getpaseo/server";
import { resolveLocalDaemonState, resolveTcpHostFromListen } from "../daemon/local-daemon.js";
import { resolveLocalHubState } from "../hub/local-hub.js";
import { selectLocalPort } from "../hub/local-port.js";
import { HubCommandError } from "../hub/error.js";

/** Existing managed homes require a ticket or authenticated local IPC recovery. */
export function assertLocalOnboardingAccess(home: string, env: NodeJS.ProcessEnv): void {
  const config = loadConfig(home, { env: { PASEO_HOME: home } });
  if (config.managedAccessMode !== "external") return;
  const state = resolveLocalDaemonState({ home });
  const listen = state.running ? state.listen : (env.PASEO_LISTEN ?? config.listen);
  if (resolveTcpHostFromListen(listen) === null) return;
  throw new HubCommandError(
    "ONBOARDING_MANAGED_HOME",
    `This home (${home}) already requires Hub-managed access over TCP. ` +
      "--owner-password configures the Hub account; it does not supply a daemon access ticket. " +
      "For fresh onboarding, select an empty --home. To keep this home, recover it through " +
      "authenticated local socket/pipe access before switching Hub. Existing data and access policy were preserved.",
  );
}

export async function onboardingDaemonListen(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const listen = env.PASEO_LISTEN ?? resolveLocalDaemonState({ home }).listen;
  const loopback = /^(?:127\.0\.0\.1|localhost):(\d+)$/.exec(listen);
  if (!loopback) return listen;
  const port = await selectLocalPort(Number(loopback[1]), !env.PASEO_LISTEN);
  return `127.0.0.1:${port}`;
}

/** A live supervisor without a listener is still booting (or repeatedly failing). */
export function recordedDaemonHost(home: string): string {
  const state = resolveLocalDaemonState({ home });
  if (!state.running || !state.pidInfo?.listen)
    throw new Error(`The daemon for ${home} has no ready listener. Check ${state.logPath}.`);
  return state.pidInfo.listen;
}

/** Verify the server identity before any workspace, agent, or enrollment mutation. */
export async function verifyOnboardingDaemon(client: DaemonClient, home: string): Promise<void> {
  try {
    const expected = (await readFile(path.join(home, "server-id"), "utf8")).trim();
    if (!expected || client.getLastServerInfoMessage()?.serverId !== expected)
      throw new Error(`The connected daemon does not belong to ${home}. Check its listener.`);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

/** The per-launch ID prevents another home on the same port from satisfying readiness. */
export async function waitForOnboardingHub(url: string, home: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const state = resolveLocalHubState({ home });
    if (!state.running || state.state?.url !== url)
      throw new Error(`The local Hub exited during startup. Check ${state.logPath}.`);
    if (await localHubResponds(url, state.state.instanceId)) {
      if (resolveLocalHubState({ home }).running) return;
      throw new Error(`The local Hub exited during startup. Check ${state.logPath}.`);
    }
    if (Date.now() >= deadline)
      throw new Error(`The local Hub did not become ready at ${url}. Check ${state.logPath}.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function localHubResponds(url: string, instanceId?: string): Promise<boolean> {
  let body: unknown;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    if (!instanceId) return true; // Existing pre-onboarding processes have no launch ID.
    body = await response.json();
  } catch {
    return false;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("instanceId" in body) ||
    body.instanceId !== instanceId
  )
    throw new Error(
      `Another Hub is answering at ${url}. Onboarding stopped before configuring it.`,
    );
  return true;
}

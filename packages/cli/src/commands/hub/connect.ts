import { isOnboardingEnabled } from "../bot/onboarding-client.js";
import { createCliLoginFlow, type CliLoginFlow } from "./login-flow.js";
import { DEFAULT_HUB_CONNECTION_PERMISSIONS } from "./permissions.js";
import type { HubStatus, HubDaemonClient } from "./daemon-client.js";
import { HubEnrollmentRequestSchema } from "@clisbot/protocol/messages";
import type { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { resolveHubCredential, resolveHubOrigin } from "./authority.js";
import type { HubHttpClient } from "./hub-client/index.js";
import type { HubCredentialStore } from "./credentials.js";
import type { HubDaemonConnection } from "./daemon-client.js";
import { withHubDaemon } from "./daemon-client.js";
import { hubStatusResult } from "./status-output.js";
import { reportHubProgress, type HubReporter } from "./reporter.js";
import { addHubResolutionHelp } from "./help.js";
import {
  readCredentialIdentity,
  reportCredentialIdentity,
  withCredentialIdentity,
} from "./credential-identity.js";

interface HubConnectOptions {
  apiKey?: string;
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
  json?: boolean;
  permission?: readonly string[];
  permissions?: readonly string[];
}

interface HubConnectDependencies {
  env: Readonly<Record<string, string | undefined>>;
  credentials: HubCredentialStore;
  hub: Pick<HubHttpClient, "issueEnrollmentToken" | "describeCredential"> &
    Partial<Pick<HubHttpClient, "startCliAuthorization" | "pollCliAuthorization">>;
  enrollment?: Pick<CliLoginFlow, "authorizeEnrollment">;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  daemon: HubDaemonConnection;
  reporter: HubReporter;
}

export async function runHubConnect(
  originInput: string | undefined,
  options: HubConnectOptions,
  dependencies: HubConnectDependencies,
) {
  const resolution = {
    options: { origin: originInput, apiKey: options.apiKey },
    env: dependencies.env,
    credentials: dependencies.credentials,
  };
  const origin = resolveHubOrigin(resolution);
  reportHubProgress(dependencies.reporter, options, `Connecting this daemon to ${origin}`);
  if (isOnboardingEnabled(dependencies.env)) {
    return connectApprovedHost(origin, options, dependencies);
  }
  const credential = resolveHubCredential({ ...resolution, origin });
  // The daemon joins the credential's organization; show where before enrolling it.
  const identity = await readCredentialIdentity(dependencies.hub, origin, credential);
  reportCredentialIdentity(dependencies.reporter, options, origin, identity);
  const token = await dependencies.hub.issueEnrollmentToken(origin, credential);
  const permissions = options.permissions ?? options.permission ?? [];
  return withHubDaemon(dependencies.daemon, options.daemonTarget, async (daemon) => {
    const response = await daemon.connectHub(origin, token, permissions);
    if (
      response.status.hubOrigin !== null &&
      !samePermissions(response.status.permissions, permissions)
    ) {
      await daemon.disconnectHub(false).catch(() => undefined);
      throw new Error(
        "The daemon did not honor the requested Hub access. Update Clisbot before connecting it.",
      );
    }
    return withCredentialIdentity(hubStatusResult(response.status), identity);
  });
}

export function addHubConnectCommand(parent: Command, dependencies: HubConnectDependencies): void {
  addJsonAndDaemonHostOptions(
    addHubResolutionHelp(
      parent
        .command("connect")
        .description("Connect this Host to Hub with one browser approval; no CLI login required")
        .argument("[origin]", "Clisbot Hub origin")
        .option("--api-key <secret>", "Organization API key")
        .option("--permission <permission...>", "Grant daemon permission during connection"),
    ),
  ).action(
    withOutput(async (...args) => {
      const origin = args[0] as string | undefined;
      const options = args.at(-2) as HubConnectOptions;
      return runHubConnect(origin, options, dependencies);
    }),
  );
}

function samePermissions(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((scope) => actual.includes(scope));
}

async function connectApprovedHost(
  origin: string,
  options: HubConnectOptions,
  dependencies: HubConnectDependencies,
) {
  return withHubDaemon(dependencies.daemon, options.daemonTarget, async (daemon) => {
    const current = (await daemon.getHubStatus()).status;
    if (current.hubOrigin && current.hubOrigin !== origin) {
      throw new Error(
        `This Host is connected to ${current.hubOrigin}. Disconnect it explicitly before changing Hub.`,
      );
    }
    if (current.hubOrigin) {
      const requested = options.permissions ?? options.permission;
      if (requested && !samePermissions(current.permissions, requested))
        throw new Error(
          "This Host is already enrolled with different permissions. Use hub permissions to change them explicitly.",
        );
      if (current.state === "revoked")
        throw new Error("This Host was revoked. Disconnect it before enrolling again.");
      return withCredentialIdentity(
        hubStatusResult(await waitForConnection(daemon, origin, dependencies)),
        undefined,
      );
    }
    const explicitKey = options.apiKey ?? dependencies.env.CLISBOT_HUB_API_KEY;
    const permissions =
      options.permissions ?? options.permission ?? DEFAULT_HUB_CONNECTION_PERMISSIONS;
    const token =
      explicitKey !== undefined
        ? await dependencies.hub.issueEnrollmentToken(origin, explicitKey)
        : await (dependencies.enrollment ?? enrollmentFlow(dependencies.hub)).authorizeEnrollment(
            origin,
            requestedEnrollment(daemon, current, permissions),
          );
    const response = await daemon.connectHub(origin, token, permissions);
    if (response.status.hubOrigin && !samePermissions(response.status.permissions, permissions)) {
      await daemon.disconnectHub(false).catch(() => undefined);
      throw new Error(
        "The daemon did not honor the approved Hub permissions. Update Clisbot before connecting it.",
      );
    }
    // Enrollment enables Managed Access and closes this ticketless CLI connection.
    // Its final RPC response is authoritative; the browser follows connection progress.
    if (response.status.state !== "connected") {
      reportHubProgress(
        dependencies.reporter,
        options,
        "Host connection is continuing in the background. Check its status in Hub → Hosts.",
      );
    }
    return withCredentialIdentity(hubStatusResult(response.status), undefined);
  });
}

function requestedEnrollment(
  daemon: HubDaemonClient,
  status: HubStatus,
  permissions: readonly string[],
) {
  // COMPAT(hubEnrollmentIdentity): never fall back to broad CLI login on an older daemon.
  if (
    daemon.getLastServerInfoMessage?.()?.features?.hubEnrollmentIdentity !== true ||
    !status.enrollmentIdentity
  )
    throw new Error(
      "Update the Host to use browser-approved hub connect, or explicitly supply a scoped enrollment API key.",
    );
  return HubEnrollmentRequestSchema.parse({ ...status.enrollmentIdentity, permissions });
}

async function waitForConnection(
  daemon: HubDaemonClient,
  origin: string,
  dependencies: HubConnectDependencies,
): Promise<HubStatus> {
  const now = dependencies.now ?? Date.now;
  const wait =
    dependencies.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + 60_000;
  let status = (await daemon.getHubStatus()).status;
  while (
    status.hubOrigin === origin &&
    ["connecting", "reconnecting"].includes(status.state) &&
    now() < deadline
  ) {
    await wait(500);
    status = (await daemon.getHubStatus()).status;
  }
  if (status.hubOrigin !== origin || status.state !== "connected") {
    throw new Error(
      `Host connection is ${status.state}${status.lastError ? `: ${status.lastError}` : ""}. Check clisbot hub status; run connect again to wait for this enrollment.`,
    );
  }
  return status;
}

function enrollmentFlow(hub: HubConnectDependencies["hub"]) {
  if (!hub.startCliAuthorization || !hub.pollCliAuthorization)
    throw new Error("Host enrollment authorization is unavailable");
  return createCliLoginFlow({
    startCliAuthorization: hub.startCliAuthorization.bind(hub),
    pollCliAuthorization: hub.pollCliAuthorization.bind(hub),
  });
}

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
  json?: boolean;
  permission?: readonly string[];
  permissions?: readonly string[];
}

interface HubConnectDependencies {
  env: Readonly<Record<string, string | undefined>>;
  credentials: HubCredentialStore;
  hub: Pick<HubHttpClient, "issueEnrollmentToken" | "describeCredential">;
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
  const credential = resolveHubCredential({ ...resolution, origin });
  // The daemon joins the credential's organization; show where before enrolling it.
  const identity = await readCredentialIdentity(dependencies.hub, origin, credential);
  reportCredentialIdentity(dependencies.reporter, options, origin, identity);
  const token = await dependencies.hub.issueEnrollmentToken(origin, credential);
  const permissions = options.permissions ?? options.permission ?? [];
  return withHubDaemon(dependencies.daemon, options.host, async (daemon) => {
    const response = await daemon.connectHub(origin, token, permissions);
    if (
      response.status.hubOrigin !== null &&
      !samePermissions(response.status.permissions, permissions)
    ) {
      await daemon.disconnectHub(false).catch(() => undefined);
      throw new Error(
        "The daemon did not honor the requested Hub access. Update Paseo before connecting it.",
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
        .description("Enroll this daemon with a Paseo Hub")
        .argument("[origin]", "Paseo Hub origin")
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

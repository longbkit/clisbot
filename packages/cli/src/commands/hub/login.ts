import { isOnboardingEnabled } from "../bot/onboarding-client.js";
import type { CommandOptions } from "../../output/index.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import type { Command } from "commander";
import { withOutput, type OutputSchema, type SingleResult } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import type { HubCredentialStore } from "./credentials.js";
import type { CliLoginFlow } from "./login-flow.js";
import { resolveHubOrigin } from "./authority.js";
import { reportHubProgress, type HubReporter } from "./reporter.js";
import { addHubResolutionHelp } from "./help.js";
import {
  identityFields,
  readCredentialIdentity,
  reportCredentialIdentity,
  type CredentialIdentityReader,
  type IdentityFields,
} from "./credential-identity.js";

interface HubLoginResult extends IdentityFields {
  origin: string;
  status: "logged_in";
}

const schema: OutputSchema<HubLoginResult> = {
  idField: "origin",
  columns: [
    { header: "HUB", field: "origin" },
    { header: "STATUS", field: "status" },
    { header: "ORGANIZATION", field: "organization" },
    { header: "ACCOUNT", field: "account" },
    { header: "ROLE", field: "role" },
  ],
};

interface HubLoginDependencies {
  env: Readonly<Record<string, string | undefined>>;
  credentials: HubCredentialStore;
  flow: Pick<CliLoginFlow, "authorize">;
  hub: CredentialIdentityReader;
  reporter: HubReporter;
  isInteractive?(): boolean;
  planGuidedSetup?(origin: string, daemonTarget: DaemonTarget): Promise<() => Promise<void>>;
  continueGuidedSetup?(origin: string, daemonTarget: DaemonTarget): Promise<void>;
}

export async function runHubLogin(
  originInput: string | undefined,
  options: Pick<CommandOptions, "json" | "daemonTarget">,
  dependencies: HubLoginDependencies,
): Promise<SingleResult<HubLoginResult>> {
  const origin = resolveHubOrigin({
    options: { origin: originInput },
    env: dependencies.env,
    credentials: dependencies.credentials,
  });
  const guided =
    !isOnboardingEnabled(dependencies.env) &&
    !options.json &&
    dependencies.isInteractive?.() === true;
  const continueSetup =
    guided && dependencies.planGuidedSetup !== undefined
      ? await dependencies.planGuidedSetup(origin, options.daemonTarget)
      : undefined;
  reportHubProgress(dependencies.reporter, options, `Logging in to ${origin}`);
  dependencies.reporter.progress(
    "Advanced CLI access: this creates a durable organization credential for reading Projects, validating/installing configuration, dispatching runs and enrolling Hosts. It remains valid until revoked on the Hub; logout only removes the local copy. To add a Host, use clisbot hub connect instead.",
  );
  const credential = await dependencies.flow.authorize(origin);
  dependencies.credentials.save({ origin, credential });
  reportHubProgress(dependencies.reporter, options, "Logged in");
  const identity = await readCredentialIdentity(dependencies.hub, origin, credential);
  reportCredentialIdentity(dependencies.reporter, options, origin, identity);
  if (continueSetup) await continueSetup();
  else if (
    !isOnboardingEnabled(dependencies.env) &&
    !options.json &&
    dependencies.isInteractive?.() &&
    dependencies.continueGuidedSetup !== undefined
  ) {
    await dependencies.continueGuidedSetup(origin, options.daemonTarget);
  }
  return {
    type: "single",
    data: { origin, status: "logged_in", ...identityFields(identity) },
    schema,
  };
}

export function addHubLoginCommand(parent: Command, dependencies: HubLoginDependencies): void {
  addJsonOption(
    addHubResolutionHelp(
      parent
        .command("login")
        .description(
          "Advanced: grant durable organization API access to this CLI (not Host onboarding)",
        )
        .argument("[origin]", "Clisbot Hub origin"),
    ),
  ).action(
    withOutput(async (...args) => {
      const origin = args[0] as string | undefined;
      const options = args.at(-2) as CommandOptions;
      return runHubLogin(origin, options, dependencies);
    }),
  );
}

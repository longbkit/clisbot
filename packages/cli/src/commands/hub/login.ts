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
  continueGuidedSetup?(origin: string): Promise<void>;
  /** Asks the setup questions before the browser approval and returns what runs after it. Used
   * instead of `continueGuidedSetup` when present. */
  planGuidedSetup?(origin: string): Promise<() => Promise<void>>;
}

export async function runHubLogin(
  originInput: string | undefined,
  options: { json?: boolean },
  dependencies: HubLoginDependencies,
): Promise<SingleResult<HubLoginResult>> {
  const origin = resolveHubOrigin({
    options: { origin: originInput },
    env: dependencies.env,
    credentials: dependencies.credentials,
  });
  const guided = !options.json && dependencies.isInteractive?.() === true;
  const continueSetup =
    guided && dependencies.planGuidedSetup !== undefined
      ? await dependencies.planGuidedSetup(origin)
      : undefined;
  reportHubProgress(dependencies.reporter, options, `Logging in to ${origin}`);
  const credential = await dependencies.flow.authorize(origin);
  dependencies.credentials.save({ origin, credential });
  reportHubProgress(dependencies.reporter, options, "Logged in");
  const identity = await readCredentialIdentity(dependencies.hub, origin, credential);
  reportCredentialIdentity(dependencies.reporter, options, origin, identity);
  if (continueSetup !== undefined) await continueSetup();
  else if (guided && dependencies.continueGuidedSetup !== undefined) {
    await dependencies.continueGuidedSetup(origin);
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
        .description("Log in to a Paseo Hub for CLI access")
        .argument("[origin]", "Paseo Hub origin"),
    ),
  ).action(
    withOutput(async (...args) => {
      const origin = args[0] as string | undefined;
      const options = args.at(-2) as { json?: boolean };
      return runHubLogin(origin, options, dependencies);
    }),
  );
}

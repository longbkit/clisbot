import { parseTokenInput, resolveTokenSecret } from "./token-input.js";
import type { BotStartOptions } from "./plan.js";

/** Bootstrap credentials go only to the child Hub environment, never the manifest. */
export function ownerBootstrapEnvironment(
  options: BotStartOptions,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!options.ownerPassword) return env;
  if (!options.ownerEmail)
    throw new Error("--owner-password requires --owner-email for initial Account setup");
  const password = resolveTokenSecret(parseTokenInput(options.ownerPassword), env);
  if (password.length < 12)
    throw new Error("The initial owner password must contain at least 12 characters");
  return {
    ...env,
    PASEO_BOOTSTRAP_ORGANIZATION: options.organizationName ?? "Clisbot",
    PASEO_BOOTSTRAP_OWNER_EMAIL: options.ownerEmail,
    PASEO_BOOTSTRAP_OWNER_PASSWORD: password,
    CLISBOT_BOOTSTRAP_ORGANIZATION: options.organizationName ?? "Clisbot",
    CLISBOT_BOOTSTRAP_OWNER_EMAIL: options.ownerEmail,
    CLISBOT_BOOTSTRAP_OWNER_PASSWORD: password,
  };
}

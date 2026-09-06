import { Command } from "commander";
import { withOutput, type CommandOptions } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import {
  addControlPlaneTargetOptions,
  extractControlPlaneOptions,
  resolveControlPlaneTarget,
} from "../control-plane.js";
import { parseTokenInput, resolveTokenSecret } from "../bot/token-input.js";
import { HubCommandError } from "./error.js";

export async function resetHubPassword(input: {
  origin: string;
  email: string;
  masterPassword: string;
  newPassword: string;
}): Promise<void> {
  const url = validateRecoveryInput(input);
  let response: Response;
  try {
    response = await fetch(new URL("/api/auth/paseo/reset-password", url), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        origin: url.origin,
        authorization: `Bearer ${input.masterPassword}`,
      },
      body: JSON.stringify({ email: input.email, newPassword: input.newPassword }),
    });
  } catch {
    throw new HubCommandError(
      "PASSWORD_RESET_UNCONFIRMED",
      "Hub did not confirm the reset. Check connectivity and try signing in before retrying.",
    );
  }
  if (response.ok) {
    const result: unknown = await response.json().catch(() => undefined);
    if (
      typeof result === "object" &&
      result !== null &&
      "code" in result &&
      result.code === "password_reset"
    )
      return;
    throw new HubCommandError(
      "PASSWORD_RESET_UNCONFIRMED",
      "Hub returned an unexpected response. Check the Hub address and try signing in before retrying.",
    );
  }
  await response.body?.cancel();
  throw new HubCommandError(
    "PASSWORD_RESET_FAILED",
    `${resetFailureHint(response.status)} (HTTP ${response.status})`,
  );
}

export function passwordResetCommand(): Command {
  const command = addJsonOption(addControlPlaneTargetOptions(new Command("reset")))
    .description("Reset an existing account using the Hub's configured master password")
    .requiredOption("--email <email>", "Existing Hub account email")
    .requiredOption(
      "--master-password <value>",
      "Master password (prefer ${ENV_VAR} or a private secret file)",
    )
    .requiredOption(
      "--new-password <value>",
      "New password, 12–128 characters (prefer ${ENV_VAR} or a private secret file)",
    );
  command.action(
    withOutput(async (options: CommandOptions, _command: Command) => {
      const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
      const email = String(options.email).trim();
      await resetHubPassword({
        origin: target.origin,
        email,
        masterPassword: resolveTokenSecret(parseTokenInput(String(options.masterPassword))),
        newPassword: resolveTokenSecret(parseTokenInput(String(options.newPassword))),
      });
      return {
        type: "single",
        data: { email, reset: true },
        schema: {
          idField: "email",
          columns: [
            { header: "ACCOUNT", field: "email" },
            { header: "RESET", field: "reset" },
          ],
          renderHuman: () =>
            `Password reset for ${email}. Sign in again with the new password. Previous account sessions were revoked.`,
        },
      };
    }),
  );
  return command;
}

function validateRecoveryInput(input: {
  origin: string;
  newPassword: string;
  masterPassword: string;
}): URL {
  const url = new URL(input.origin);
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new HubCommandError(
      "INSECURE_RECOVERY_URL",
      "Password recovery requires HTTPS or loopback HTTP.",
    );
  if (input.newPassword.length < 12 || input.newPassword.length > 128)
    throw new HubCommandError(
      "INVALID_PASSWORD",
      "The new password must contain between 12 and 128 characters.",
    );
  if (input.masterPassword.length < 32 || input.masterPassword.length > 1024)
    throw new HubCommandError(
      "INVALID_MASTER_PASSWORD",
      "The master password must contain between 32 and 1024 characters.",
    );
  if (!/^[\x21-\x7e]+$/.test(input.masterPassword))
    throw new HubCommandError(
      "INVALID_MASTER_PASSWORD",
      "The master password must use printable ASCII characters without spaces.",
    );
  return url;
}

function resetFailureHint(status: number): string {
  if (status === 401) return "The master password was rejected.";
  if (status === 404)
    return "Recovery is disabled, this Hub is outdated, or the password account does not exist.";
  if (status === 429) return "Too many recovery attempts. Wait at least 60 seconds.";
  return "Hub did not confirm the reset. Check the account and password requirements before retrying.";
}

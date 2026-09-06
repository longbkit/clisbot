import { passwordResetCommand } from "./password-reset.js";
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

/** Change a known password through the existing authenticated Hub account API. */
export async function changeHubPassword(input: {
  origin: string;
  email: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  if (input.newPassword.length < 12)
    throw new HubCommandError(
      "INVALID_PASSWORD",
      "The new password must contain at least 12 characters.",
    );
  const cookies = new Map<string, string>();
  const post = async (endpoint: string, body: Record<string, string | boolean>) => {
    const response = await fetch(new URL(`/api/auth/${endpoint}`, input.origin), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        origin: input.origin,
        cookie: [...cookies.values()].join("; "),
      },
      body: JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const cookie = header.split(";")[0]!;
      cookies.set(cookie.split("=")[0]!, cookie);
    }
    await response.body?.cancel();
    return response;
  };
  const signedIn = await post("sign-in/email", {
    email: input.email,
    password: input.currentPassword,
  });
  if (!signedIn.ok)
    throw new HubCommandError(
      "PASSWORD_SIGN_IN_FAILED",
      `Hub sign-in failed (HTTP ${signedIn.status}). Check your email and current password.`,
    );
  try {
    const changed = await post("change-password", {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: true,
    });
    if (!changed.ok)
      throw new HubCommandError(
        "PASSWORD_CHANGE_FAILED",
        `Hub did not confirm the password change (HTTP ${changed.status}). Check before retrying.`,
      );
  } finally {
    await post("sign-out", {}).catch(() => undefined);
  }
}

export function passwordCommand(): Command {
  const password = new Command("password").description("Manage your Hub account password");
  const change = addJsonOption(addControlPlaneTargetOptions(new Command("change")))
    .description("Change a known password; signs out other sessions")
    .requiredOption("--email <email>", "Hub account email")
    .requiredOption(
      "--current-password <value>",
      "Current password (prefer ${ENV_VAR} or a private secret file)",
    )
    .requiredOption(
      "--new-password <value>",
      "New password, at least 12 characters (prefer ${ENV_VAR} or a private secret file)",
    );
  change.action(
    withOutput(async (options: CommandOptions, _command: Command) => {
      const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
      const email = String(options.email).trim();
      await changeHubPassword({
        origin: target.origin,
        email,
        currentPassword: resolveTokenSecret(parseTokenInput(String(options.currentPassword))),
        newPassword: resolveTokenSecret(parseTokenInput(String(options.newPassword))),
      });
      return {
        type: "single",
        data: { email, changed: true },
        schema: {
          idField: "email",
          columns: [
            { header: "ACCOUNT", field: "email" },
            { header: "CHANGED", field: "changed" },
          ],
          renderHuman: () => `Password changed for ${email}. Other sessions were signed out.`,
        },
      };
    }),
  );
  password.addCommand(change);
  password.addCommand(passwordResetCommand());
  return password;
}

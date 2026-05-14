import { renderCliCommand } from "../../control/commands/cli-name.ts";

type ChannelStartupFailureDiagnostic = {
  summary: string;
  detail?: string;
  actions: string[];
};

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error).trim();
}

export function describeSlackStartupFailure(
  error: unknown,
): ChannelStartupFailureDiagnostic {
  const detail = normalizeErrorMessage(error);
  const lowered = detail.toLowerCase();

  if (
    lowered.includes("xapp") ||
    lowered.includes("app token") ||
    lowered.includes("socket mode") ||
    lowered.includes("connections:write")
  ) {
    return {
      summary: "Socket Mode app token was rejected.",
      actions: [
        "verify `bots.slack.<botId>.appToken` resolves to an `xapp-` token",
        "enable Slack Socket Mode and grant the app token `connections:write`",
        "confirm the app token and bot token belong to the same Slack app and workspace",
      ],
    };
  }

  if (
    lowered.includes("invalid_auth") ||
    lowered.includes("not_authed") ||
    lowered.includes("account_inactive") ||
    lowered.includes("token")
  ) {
    return {
      summary: "Slack token authentication failed.",
      actions: [
        "verify `bots.slack.<botId>.botToken` resolves to a valid `xoxb-` token",
        "confirm the Slack app was installed to the target workspace after the latest token rotation",
        "confirm the bot token and app token belong to the same Slack app and workspace",
      ],
    };
  }

  if (lowered.includes("missing_scope") || lowered.includes("scope")) {
    return {
      summary: "Slack app permissions are incomplete.",
      actions: [
        "add the missing Slack scopes and event subscriptions for the routes you expect to handle",
        "reinstall the Slack app after changing scopes",
        `run ${renderCliCommand("logs", { inline: true })} again after reinstall to confirm the missing-scope error is gone`,
      ],
    };
  }

  return {
    summary: "Slack channel failed to start.",
    actions: [
      `run ${renderCliCommand("logs", { inline: true })} and inspect the latest Slack startup error`,
      "verify the Slack app token, bot token, and workspace match",
      "verify Socket Mode and the required Slack scopes are enabled before restarting `clisbot`",
    ],
  };
}

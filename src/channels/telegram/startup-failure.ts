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

export function describeTelegramStartupFailure(
  error: unknown,
): ChannelStartupFailureDiagnostic {
  return {
    summary: "Telegram channel failed to start.",
    detail: normalizeErrorMessage(error),
    actions: [
      "verify `bots.telegram.<botId>.botToken` resolves to the intended bot token",
      "confirm no other Telegram bot instance is polling the same token",
      `run ${renderCliCommand("logs", { inline: true })} again after restarting to confirm the startup error is gone`,
    ],
  };
}

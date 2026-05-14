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

export function describeZaloBotStartupFailure(
  error: unknown,
): ChannelStartupFailureDiagnostic {
  return {
    summary: "Zalo Bot channel failed to start.",
    detail: normalizeErrorMessage(error),
    actions: [
      "verify `bots.zaloBot.<botId>.botToken` resolves to the intended bot token",
      "confirm no other Zalo Bot instance is polling the same token when mode is `polling`",
      `run ${renderCliCommand("logs", { inline: true })} again after restarting to confirm the startup error is gone`,
    ],
  };
}

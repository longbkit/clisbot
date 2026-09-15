import { withHubDaemon } from "./daemon-client.js";
import {
  ensureDaemonConnection,
  reportHubNextSteps,
  reportMessage,
  requiredSelect,
  type HubGuidedSetupEnvironment,
} from "./init.js";
import { hubLoginResumeCommand, resolveHubInitConnection } from "./init-plan.js";

type LoginConnectionChoice = "connect" | "skip";

export const LOGIN_CONNECTION_QUESTION =
  "Connect this daemon to Hub after you approve in the browser?\n\nThe organization you approve can then create workspaces and run agents here from Automations and Channels (GitHub, Slack, Discord, Linear, Telegram, and other integrations), with the files and commands their workspace runtime allows.";

/**
 * `hub login` asks about this daemon once, before the browser approval, so the approval is the
 * last step: afterwards the daemon connects with the chosen permissions and nothing else is asked.
 */
export async function planHubLoginConnection(
  origin: string,
  environment: HubGuidedSetupEnvironment,
): Promise<() => Promise<void>> {
  const status = await withHubDaemon(environment.daemon, undefined, async (daemon) =>
    daemon.getHubStatus().then((response) => response.status),
  ).catch(() => null);
  const later = `Connect later with: ${hubLoginResumeCommand("connect", origin)}`;
  if (status === null) {
    reportMessage(environment, `No running daemon found, so only the CLI logs in. ${later}`);
    return async () => reportHubNextSteps(origin, environment);
  }
  const current = resolveHubInitConnection(status, origin);
  if (current.kind === "conflict") {
    reportMessage(
      environment,
      `This daemon is connected to ${current.origin}, so only the CLI logs in to ${origin}. Disconnect it first to connect it here.`,
    );
    return async () => reportHubNextSteps(origin, environment);
  }
  if (current.kind === "connected") {
    reportMessage(
      environment,
      `This daemon is already connected to ${origin}. Permissions: ${status.permissions.join(", ") || "None"}.`,
    );
    return async () => reportHubNextSteps(origin, environment);
  }
  if (current.kind === "pending") {
    return async () => {
      await ensureDaemonConnection(origin, environment, true, status.permissions);
      reportHubNextSteps(origin, environment);
    };
  }
  const choice = await chooseLoginConnection(environment);
  return async () => {
    await applyLoginConnection(origin, environment, choice, later);
    reportHubNextSteps(origin, environment);
  };
}

function chooseLoginConnection(
  environment: HubGuidedSetupEnvironment,
): Promise<LoginConnectionChoice> {
  return requiredSelect<LoginConnectionChoice>(environment, {
    message: LOGIN_CONNECTION_QUESTION,
    initialValue: "connect",
    options: [
      { value: "connect", label: "Connect and let Hub run agents here" },
      { value: "skip", label: "Don't connect now" },
    ],
  });
}

async function applyLoginConnection(
  origin: string,
  environment: HubGuidedSetupEnvironment,
  choice: LoginConnectionChoice,
  later: string,
): Promise<void> {
  if (choice === "skip") {
    reportMessage(environment, `Skipped daemon connection. ${later}`);
    return;
  }
  await ensureDaemonConnection(origin, environment, true, ["hub.execute"]);
  reportMessage(
    environment,
    "Daemon connected. Hub can run agents here.\n\nDisconnect it with:\n  paseo hub disconnect",
  );
}

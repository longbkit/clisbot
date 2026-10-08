import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, CLISBOT_HUB_URL, then active stored login; with none of these the command stops and asks for a Hub URL.\nAPI command credential precedence: --api-key, CLISBOT_HUB_API_KEY, then a stored login for the exact resolved origin.\nHost onboarding: hub connect uses browser approval unless --api-key or CLISBOT_HUB_API_KEY is supplied; it does not use stored CLI credentials (default onboarding mode).\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}

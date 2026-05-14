import { renderCliCommand } from "./cli-name.ts";

export async function runChannelsCli(_args: string[]) {
  throw new Error(
    `Use ${renderCliCommand("routes ...", { inline: true })} for route management and ${renderCliCommand("bots ...", { inline: true })} for bot management.`,
  );
}

import { renderCliCommand } from "./cli-name.ts";

export async function runAccountsCli(_args: string[]) {
  throw new Error(`Use ${renderCliCommand("bots ...", { inline: true })} instead.`);
}

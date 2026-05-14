import { renderCliCommand } from "./cli-name.ts";

export function renderChannelPrivilegeCliRemovedMessage() {
  return [
    `${renderCliCommand("channels privilege", { inline: true })} has been removed.`,
    "Manage routed permissions through `app.auth` and `agents.<id>.auth` instead.",
    "Grant `shellExecute` on the target agent role when `/bash` should be allowed.",
  ].join("\n");
}

export async function runChannelPrivilegeCli(_args: string[]) {
  throw new Error(renderChannelPrivilegeCliRemovedMessage());
}

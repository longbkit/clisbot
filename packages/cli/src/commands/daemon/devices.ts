import { Command } from "commander";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";

export function devicesCommand(): Command {
  const command = new Command("devices").description(
    "List, label and revoke daemon device credentials and sessions",
  );
  for (const verb of ["ls", "rename", "revoke"] as const) {
    const child = addJsonAndDaemonHostOptions(command.command(verb));
    if (verb !== "ls") child.argument("<device-id>");
    if (verb === "rename") child.argument("<label>");
    child.action(
      withGlobalOptions(async (...args) => {
        const options = args.at(-2) as { daemonTarget: DaemonTarget };
        const client = await connectToDaemon({ target: options.daemonTarget });
        try {
          const action = daemonDeviceAction(verb, args);
          console.log(JSON.stringify(await client.devices(action), null, 2));
        } finally {
          await client.close();
        }
      }),
    );
  }
  return command;
}

function daemonDeviceAction(verb: "ls" | "rename" | "revoke", args: unknown[]) {
  if (verb === "ls") return { kind: "list" as const };
  const deviceId = String(args[0]);
  if (verb === "rename") return { kind: "rename" as const, deviceId, label: String(args[1]) };
  return { kind: "revoke" as const, deviceId };
}

import { resolveLocalPairingOffer } from "../daemon/pair.js";
import { loadConfig } from "@clisbot/server/configuration";
import { resumeLocalServices } from "../serve/resume.js";
import { Command } from "commander";
import { withGlobalOptions } from "../../utils/command-options.js";
import { resolveLocalHubHome } from "../hub/local-hub.js";
import { startLocalWeb, localWebStatus, stopLocalWeb } from "../serve/web.js";

export function createWebCommand(): Command {
  const web = new Command("web").description(
    "Optional local browser UI; preserves Bot and Hub services",
  );
  web
    .command("resume", { hidden: true })
    .option("--home <path>")
    .option("--json")
    .action(
      withGlobalOptions(async (options) => {
        try {
          await resumeLocalServices(resolveLocalHubHome({ home: options.home }));
          console.log("{}");
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      }),
    );
  for (const action of ["start", "status", "stop"] as const) {
    const command = web
      .command(action)
      .option("--home <path>", "Clisbot home directory")
      .option("--json", "Output JSON");
    if (action === "start")
      command.option("--port <port>", "Preferred loopback port (default: saved or 6880)");
    command.action(
      withGlobalOptions(async (options) => {
        try {
          const home = resolveLocalHubHome({ home: options.home });
          const result = await performWebAction(action, home, options.port);
          const ownerPairingUrl =
            action === "start" &&
            result.origin &&
            loadConfig(home, { env: { CLISBOT_HOME: home } }).devicePairingEnabled
              ? await localWebOwnerLink(home, result.origin)
              : undefined;
          console.log(
            options.json
              ? JSON.stringify({ ...result, ...(ownerPairingUrl ? { ownerPairingUrl } : {}) })
              : `${action === "stop" ? "Local web stopped; Bot, Host and Hub preserved." : `Local web: ${result.origin ?? "stopped"}`}\nHome: ${home}${ownerPairingUrl ? `\nOpen this single-use owner pairing link to authorize your browser (expires in 5 minutes):\n${ownerPairingUrl}` : ""}`,
          );
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      }),
    );
  }
  return web;
}

async function performWebAction(action: "start" | "stop" | "status", home: string, port?: string) {
  if (action === "start") return startLocalWeb(home, port ? Number(port) : undefined);
  if (action === "stop") return stopLocalWeb(home);
  return localWebStatus(home);
}

async function localWebOwnerLink(home: string, origin: string): Promise<string | undefined> {
  const offer = await resolveLocalPairingOffer({
    clisbotHome: home,
    enableRelay: false,
    direct: { endpoint: new URL(origin).host, useTls: false },
  });
  if (!offer.url) return undefined;
  const url = new URL(origin);
  url.hash = new URL(offer.url).hash;
  return url.href;
}

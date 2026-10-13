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
      .description(
        {
          start: "Start protected local web and print local/private URLs plus Owner access",
          status: "Check the local gateway, private mapping and required access",
          stop: "Stop only local web and its owned private mapping",
        }[action],
      )
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
            result.access === "owner-pairing" &&
            result.origin &&
            loadConfig(home, { env: { CLISBOT_HOME: home } }).devicePairingEnabled
              ? await localWebOwnerLink(home, result.origin)
              : undefined;
          console.log(
            options.json
              ? JSON.stringify({ ...result, ...(ownerPairingUrl ? { ownerPairingUrl } : {}) })
              : formatWebOutput(action, { ...result, ownerPairingUrl }),
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

export function formatWebOutput(
  action: "start" | "status" | "stop",
  result: {
    home: string;
    origin: string | null;
    running: boolean;
    tailscaleUrl: string | null;
    tailscaleState: string;
    networkGuidance: string;
    access: string;
    ownerPairingUrl?: string;
  },
): string {
  const lines = [
    action === "stop"
      ? "Local web stopped; Bot, Host and Hub preserved."
      : `Local web: ${result.running ? "running" : "stopped"}`,
    `Home: ${result.home}`,
  ];
  if (result.running) {
    lines.push(
      `Local URL: ${result.origin}`,
      `Private URL: ${result.tailscaleUrl ?? "unavailable"}`,
      `Tailscale: ${result.tailscaleState}`,
      result.networkGuidance,
    );
    if (result.access === "hub-ticket")
      lines.push(
        "Access: sign in to this Host's enrolled Hub; Hub access is required. An Owner pairing link does not bypass managed access.",
      );
    else if (result.access === "setup-required")
      lines.push(
        "Access: protected device setup is required on this Host before exposing local web.",
      );
    else if (result.ownerPairingUrl)
      lines.push(
        "Access: open this single-use Owner pairing link to authorize your browser (expires in 5 minutes):",
        result.ownerPairingUrl,
        "Keep this invitation private; the web URL alone grants no access.",
      );
    else
      lines.push(
        "Access: use a paired Owner device. To authorize a new browser, run clisbot web start on this Host for an Owner invitation.",
      );
  }
  if (!result.running && action !== "stop") lines.push("Next: run clisbot web start on this Host.");
  return lines.join("\n");
}

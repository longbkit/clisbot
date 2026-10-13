import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runLocalCliJson } from "../local-cli.js";
const Status = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  origin: z.string().nullable(),
  tailscaleUrl: z.string().nullable(),
});
/** The Host owner asks its local CLI coordinator; this never serves Hub through daemon. */
export async function controlHostLocalWeb(home: string, action: "start" | "status" | "stop") {
  return Status.parse(
    await runLocalCliJson({
      home,
      args: ["web", action, "--home", home, "--json"],
      timeoutMs: 100_000,
      failure: "Local web operation failed; inspect this Host's gateway.log",
    }),
  );
}

/** Installed daemon/Desktop/OS-service startup honors saved owner intent once. */
export async function resumeHostLocalServices(home: string): Promise<void> {
  const read = (name: string): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(path.join(home, name), "utf8"));
    } catch {
      return {};
    }
  };
  const web = read("web-intent.json");
  const hub = read("hub-local.json");
  if (web["enabled"] !== true && (!hub["pid"] || hub["stoppedAt"])) return;
  await runLocalCliJson({
    home,
    args: ["web", "resume", "--home", home, "--json"],
    timeoutMs: 120_000,
    failure: "Saved local services could not resume; inspect the Host's service logs",
  });
}

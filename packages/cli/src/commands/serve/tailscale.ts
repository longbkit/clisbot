import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  readTailscaleServeHandler,
  runTailscale,
  type TailscaleRunner,
} from "@clisbot/server/gateway-adapters";
import { writeServiceFile } from "../../utils/service-files.js";

export async function configureTailscaleServe(
  options: { home: string; dnsName: string; port: number; target: string },
  run: TailscaleRunner = runTailscale,
): Promise<string> {
  const recordPath = path.join(options.home, "tailscale-serve.json");
  const record = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as { authority: string; target: string })
    : undefined;
  const authority = `${options.dnsName}:${options.port}`;
  const current = await readTailscaleServeHandler(authority, run);
  if (current && (current.proxy !== record?.target || record?.authority !== authority)) {
    throw new Error(
      `Tailscale Serve already owns https://${authority}/. Choose another --https-port; its mapping was preserved.`,
    );
  }
  await run(["serve", "--bg", `--https=${options.port}`, "--set-path=/", options.target]);
  writeServiceFile(recordPath, { authority, target: options.target });
  return new URL(`https://${authority}`).origin;
}

/** Reuse this home's HTTPS port; mapping ownership is checked separately before changes. */
export function readTailscaleServePort(home: string, dnsName: string): number | undefined {
  try {
    const record = JSON.parse(readFileSync(path.join(home, "tailscale-serve.json"), "utf8")) as {
      authority?: unknown;
    } | null;
    if (typeof record?.authority !== "string") return undefined;
    const url = new URL(`https://${record.authority}`);
    const port = Number(url.port || "443");
    return port >= 1 &&
      port <= 65535 &&
      record.authority === `${dnsName}:${port}` &&
      url.hostname === dnsName
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

export async function removeTailscaleServe(
  home: string,
  run: TailscaleRunner = runTailscale,
): Promise<void> {
  const recordPath = path.join(home, "tailscale-serve.json");
  if (!existsSync(recordPath)) return;
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
    authority: string;
    target: string;
  };
  const current = await readTailscaleServeHandler(record.authority, run);
  if (current && current.proxy !== record.target)
    throw new Error("Tailscale mapping changed outside Clisbot; it was preserved");
  const port = new URL(`https://${record.authority}`).port || "443";
  if (current) await run(["serve", `--https=${port}`, "--set-path=/", "off"]);
  unlinkSync(recordPath);
}

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  readTailscaleServeHandler,
  runTailscale,
  type TailscaleRunner,
} from "@clisbot/server/gateway-adapters";
import { writeServiceFile } from "../../utils/service-files.js";

interface ServeRecord {
  authority: string;
  target: string;
}

function readServeRecord(home: string): ServeRecord | undefined {
  const recordPath = path.join(home, "tailscale-serve.json");
  return existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as ServeRecord)
    : undefined;
}

/** A mapping Clisbot may (re)write: this home's record, or one that already reaches `target`. */
function isOwnHandler(
  authority: string,
  proxy: string | undefined,
  target: string,
  record: ServeRecord | undefined,
): boolean {
  return proxy === target || (record?.authority === authority && proxy === record.target);
}

const AUTOMATIC_PORT_CANDIDATES = 10;

/**
 * The HTTPS port to map: the preferred one when it is free or already reaches this home's
 * gateway, otherwise the next free port. An explicit `--https-port` is never replaced.
 */
export async function selectTailscaleServePort(
  options: { home: string; dnsName: string; preferred: number; fixed: boolean; target: string },
  run: TailscaleRunner = runTailscale,
): Promise<number> {
  const status = JSON.parse(await run(["serve", "status", "--json"])) as {
    TCP?: Record<string, unknown>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  const record = readServeRecord(options.home);
  const count = options.fixed ? 1 : AUTOMATIC_PORT_CANDIDATES;
  const last = Math.min(options.preferred + count - 1, 65535);
  for (let port = options.preferred; port <= last; port += 1) {
    const authority = `${options.dnsName}:${port}`;
    const web = status.Web?.[authority];
    if (!web && status.TCP?.[String(port)] === undefined) return port;
    if (web && isOwnHandler(authority, web.Handlers?.["/"]?.Proxy, options.target, record))
      return port;
  }
  const ports = last === options.preferred ? `${last}` : `${options.preferred}–${last}`;
  throw new Error(
    `Tailscale Serve already uses HTTPS port ${ports} on ${options.dnsName}. Choose another --https-port; existing mappings were preserved.`,
  );
}

export async function configureTailscaleServe(
  options: { home: string; dnsName: string; port: number; target: string },
  run: TailscaleRunner = runTailscale,
): Promise<string> {
  const recordPath = path.join(options.home, "tailscale-serve.json");
  const record = readServeRecord(options.home);
  const authority = `${options.dnsName}:${options.port}`;
  const current = await readTailscaleServeHandler(authority, run);
  if (current && !isOwnHandler(authority, current.proxy, options.target, record)) {
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

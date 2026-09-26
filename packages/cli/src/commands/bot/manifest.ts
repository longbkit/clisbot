// Local channel restart references. Version 2 stores no daemon-owned workspace or session facts.
// Version 1 remains readable for explicit adoption at its existing directory.

import { mkdir, readdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface BotManifest {
  version: 1 | 2;
  botId?: string;
  name: string;
  botType: "personal" | "team";
  provider: string;
  model?: string;
  mode?: string;
  /** The workspace this bot's agent lives in (path + daemon workspace id). */
  workspacePath: string;
  workspaceId: string;
  projectId?: string;
  isolation?: string;
  sourcePath?: string;
  /** The initial assistant session available in the app; channel conversations have their own sessions. */
  agentId: string;
  agentTitle: string;
  /** The channel the bot answers on. */
  channel: "slack" | "telegram";
  account: string;
  connectionId?: string;
  /** The intended route, recorded so `bot stop`/`bot status` can re-explain it. */
  routeNote?: string;
  /** Channel credential durability; current manifests point to encrypted Hub storage. */
  credentials: Record<string, { persisted: true }>;
  createdAt: string;
  updatedAt: string;
}

export const BOTS_DIRNAME = "bots";
const MANIFEST_VERSION = 1;
const MANIFEST_DIR_MODE = 0o700;
const MANIFEST_FILE_MODE = 0o600;
const MAX_NAME_LENGTH = 128;

/** `<home>/bots` — one directory holds every bot manifest for the home. */
export function botDirectory(home: string): string {
  return path.join(home, BOTS_DIRNAME);
}

/** `<home>/bots/<name>.json` — one manifest per bot name. */
export function botManifestPath(home: string, name: string): string {
  return path.join(botDirectory(home), `${name}.json`);
}

export function assertBotName(name: string): void {
  const trimmed = name.trim();
  if (/^bot_[0-9a-f]{16}$/.test(trimmed))
    throw new Error("Bot names cannot use the reserved daemon record id format");
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`bot name "${name}" is invalid: 1-${MAX_NAME_LENGTH} characters`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`bot name "${name}" must not contain a path separator`);
  }
}

/** Channel credentials are durable encrypted Hub Connections. */
export function credentialKindFor(manifest: BotManifest): "persisted" | "pending" {
  return manifest.credentials[`${manifest.channel}:${manifest.account}`]?.persisted
    ? "persisted"
    : "pending";
}

export function botNameFromPath(filePath: string): string | null {
  const base = path.basename(filePath);
  if (!base.endsWith(".json")) return null;
  const name = base.slice(0, -".json".length);
  return name.length > 0 ? name : null;
}

/** Read one bot's manifest; null when the file is absent or unparseable. */
export async function readBotManifest(home: string, name: string): Promise<BotManifest | null> {
  try {
    const raw = await readFile(botManifestPath(home, name), "utf8");
    return parseBotManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Every bot in the home, by manifest; an absent directory means no bots. */
export async function readBotManifests(home: string): Promise<BotManifest[]> {
  const directory = botDirectory(home);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const manifests = await Promise.all(
    entries.map(async (entry) => {
      const name = botNameFromPath(entry);
      if (name === null) return null;
      try {
        const raw = await readFile(path.join(directory, entry), "utf8");
        return parseBotManifest(JSON.parse(raw));
      } catch {
        return null;
      }
    }),
  );
  return manifests.filter((manifest): manifest is BotManifest => manifest !== null);
}

/** Atomically write a bot manifest (tmp + rename), 0600, creating the dir. */
export async function writeBotManifest(home: string, manifest: BotManifest): Promise<void> {
  const target = botManifestPath(home, manifest.name);
  await mkdir(path.dirname(target), { recursive: true, mode: MANIFEST_DIR_MODE });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(
      tmp,
      `${JSON.stringify(manifest.version === 2 ? restartReference(manifest) : manifest, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: MANIFEST_FILE_MODE,
      },
    );
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Remove a bot's manifest file (best-effort; absence is not an error). */
export async function removeBotManifest(home: string, name: string): Promise<void> {
  await rm(botManifestPath(home, name), { force: true });
}

const REQUIRED_STRING_FIELDS = [
  "name",
  "provider",
  "workspacePath",
  "workspaceId",
  "agentId",
  "agentTitle",
  "account",
] as const;

function parseBotManifest(value: unknown): BotManifest {
  const record = asManifestRecord(value);
  // COMPAT(clisbot-bot-manifest-v1): old manifests are adopted at their exact cwd.
  // The v2 disk reference has no daemon-owned fields; these empty projection
  // fields must be hydrated from bot.list before use.
  if (record["version"] === 2) {
    if (typeof record["botId"] !== "string" || !record["botId"].startsWith("bot_"))
      throw new Error("invalid bot reference");
    const legacy = parseBotManifest({
      ...record,
      version: 1,
      botType: "personal",
      provider: "",
      workspacePath: "",
      workspaceId: "",
      agentId: "",
      agentTitle: "",
    });
    return { ...legacy, version: 2, botId: record["botId"] };
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string") throw new Error("invalid bot manifest");
  }
  if (record["version"] !== MANIFEST_VERSION) throw new Error("invalid bot manifest");
  const botType = record["botType"];
  if (botType !== "personal" && botType !== "team") throw new Error("invalid bot manifest");
  const channel = record["channel"];
  if (channel !== "slack" && channel !== "telegram") throw new Error("invalid bot manifest");
  const createdAt =
    typeof record["createdAt"] === "string" ? record["createdAt"] : new Date(0).toISOString();
  const updatedAt =
    typeof record["updatedAt"] === "string" ? record["updatedAt"] : new Date(0).toISOString();
  return {
    version: MANIFEST_VERSION,
    name: record["name"] as string,
    botType: botType as "personal" | "team",
    provider: record["provider"] as string,
    ...(typeof record["model"] === "string" ? { model: record["model"] } : {}),
    ...(typeof record["mode"] === "string" ? { mode: record["mode"] } : {}),
    workspacePath: record["workspacePath"] as string,
    workspaceId: record["workspaceId"] as string,
    ...(typeof record["sourcePath"] === "string" ? { sourcePath: record["sourcePath"] } : {}),
    ...(typeof record["projectId"] === "string" ? { projectId: record["projectId"] } : {}),
    ...(typeof record["isolation"] === "string" ? { isolation: record["isolation"] } : {}),
    agentId: record["agentId"] as string,
    agentTitle: record["agentTitle"] as string,
    channel: channel as "slack" | "telegram",
    account: record["account"] as string,
    ...(typeof record["connectionId"] === "string" ? { connectionId: record["connectionId"] } : {}),
    credentials: parseManifestCredentials(record["credentials"]),
    ...(typeof record["routeNote"] === "string" ? { routeNote: record["routeNote"] } : {}),
    createdAt,
    updatedAt,
  };
}

/** A manifest record is a plain object; anything else is an unreadable file. */
function asManifestRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("not an object");
  return value as Record<string, unknown>;
}

function parseManifestCredentials(value: unknown): Record<string, { persisted: true }> {
  if (typeof value !== "object" || value === null) throw new Error("invalid bot manifest");
  const credentials: Record<string, { persisted: true }> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const cred = entry as Record<string, unknown>;
    if (typeof cred !== "object" || cred === null || cred["persisted"] !== true) {
      throw new Error("invalid bot manifest credential");
    }
    credentials[key] = { persisted: true };
  }
  return credentials;
}

function restartReference(manifest: BotManifest) {
  if (!manifest.botId) throw new Error("A v2 bot reference requires botId");
  return {
    version: 2,
    name: manifest.name,
    botId: manifest.botId,
    channel: manifest.channel,
    account: manifest.account,
    ...(manifest.connectionId ? { connectionId: manifest.connectionId } : {}),
    credentials: manifest.credentials,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

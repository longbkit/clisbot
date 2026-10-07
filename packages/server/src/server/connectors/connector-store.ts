import { renameServerKeys } from "./connector-off-lists.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ConnectorGrantSchema,
  CONNECTOR_MCP_SERVER_NAME_PATTERN,
  type ConnectorGrant,
  CONNECTOR_SECRET_NAME_PATTERN,
  type ConnectorMcpServer,
  type ConnectorSettings,
} from "@clisbot/protocol/connectors/types";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { isReservedEnvName } from "./connector-env.js";

/**
 * Connectors state on one Host (docs/features/connectors/README.md, "Data"). Two files under
 * `$CLISBOT_HOME/connectors/`: `connectors.json` holds what may be shown, `secrets.json`
 * (mode 0600) holds values no RPC returns. Writes are serialized; reads see the last write.
 */

const MAX_MCP_SERVERS = 20;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4_096;
const MAX_COMMAND_LENGTH = 1_024;
const MAX_SECRETS = 32;
const MAX_SECRET_LENGTH = 16_384;

const McpServerRecordSchema = z
  .object({
    transport: z.enum(["http", "stdio"]),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
type McpServerRecord = z.infer<typeof McpServerRecordSchema>;

// Not strict: a newer daemon may add fields, and an older one must still read the file.
const ConnectorsFileSchema = z.object({
  version: z.literal(1),
  composio: z
    .object({ userId: z.string().optional(), sessionId: z.string().optional() })
    .strict()
    .optional(),
  mcpServers: z.record(z.string(), McpServerRecordSchema).optional(),
  /** Project id → what its agent sessions may use; a Bot's Project is the Bot's grant. */
  projectGrants: z.record(z.string(), ConnectorGrantSchema).optional(),
  /** Agent id → the tools that one session may use beyond its Project's grant. */
  sessionAllows: z.record(z.string(), z.array(z.string())).optional(),
});
type ConnectorsFile = z.infer<typeof ConnectorsFileSchema>;

const SecretMapSchema = z.record(z.string(), z.string());
const SecretsFileSchema = z
  .object({
    version: z.literal(1),
    composioApiKey: z.string().optional(),
    mcpServers: z
      .record(
        z.string(),
        z.object({ headers: SecretMapSchema.optional(), env: SecretMapSchema.optional() }),
      )
      .optional(),
  })
  .strict();
type SecretsFile = z.infer<typeof SecretsFileSchema>;

const SendCountsFileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.object({ day: z.string(), count: z.number().int().min(0) })),
});
export type SendCounts = z.infer<typeof SendCountsFileSchema>["projects"];

export class ConnectorStoreError extends Error {
  constructor(
    readonly code: "invalid_request" | "conflict" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ConnectorStoreError";
  }
}

export interface McpServerSecrets {
  headers: Record<string, string>;
  env: Record<string, string>;
}

/** What `connectors.mcp_server.save` asks for, after the wire shape. */
export interface McpServerSaveInput {
  previousName?: string;
  server: Omit<ConnectorMcpServer, "headerKeys" | "envKeys">;
  headers?: Record<string, string | null>;
  env?: Record<string, string | null>;
}

async function readJson<T>(file: string, schema: z.ZodType<T>, empty: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  }
  return schema.parse(JSON.parse(raw));
}

function secretError(kind: "header" | "env", name: string, value: string | null): string | null {
  const noun = kind === "header" ? "header" : "variable";
  if (!CONNECTOR_SECRET_NAME_PATTERN.test(name)) return `"${name}" is not a valid ${noun} name.`;
  if (kind === "env" && isReservedEnvName(name)) return `"${name}" is set by Clisbot itself.`;
  if (value === null) return null;
  if (value.length > MAX_SECRET_LENGTH) return `The value of "${name}" is too long.`;
  if (kind === "header" && /[\r\n]/.test(value)) return `The header "${name}" must be one line.`;
  return null;
}

function applySecretPatch(
  kind: "header" | "env",
  current: Record<string, string> | undefined,
  patch: Record<string, string | null> | undefined,
): Record<string, string> {
  const next = { ...current };
  for (const [name, value] of Object.entries(patch ?? {})) {
    const error = secretError(kind, name, value);
    if (error) throw new ConnectorStoreError("invalid_request", error);
    if (value === null) delete next[name];
    else next[name] = value;
  }
  if (Object.keys(next).length > MAX_SECRETS) {
    const noun = kind === "header" ? "headers" : "variables";
    throw new ConnectorStoreError("invalid_request", `Use at most ${MAX_SECRETS} ${noun}.`);
  }
  return next;
}

/** Only an explicit `false` is stored; on is the default. */
function enabledField(enabled: boolean | undefined): { enabled?: false } {
  return enabled === false ? { enabled: false } : {};
}

function validateServer(server: McpServerSaveInput["server"]): McpServerRecord {
  if (!CONNECTOR_MCP_SERVER_NAME_PATTERN.test(server.name)) {
    throw new ConnectorStoreError(
      "invalid_request",
      "A server name starts with a letter and uses lowercase letters, digits, - and _ (at most 32).",
    );
  }
  if (server.transport !== "http" && server.transport !== "stdio") {
    throw new ConnectorStoreError(
      "invalid_request",
      "A server runs over http or as a local command.",
    );
  }
  if (server.transport === "http") {
    let url: URL;
    try {
      url = new URL(server.url ?? "");
    } catch {
      throw new ConnectorStoreError("invalid_request", "Enter the server's full URL.");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new ConnectorStoreError("invalid_request", "A remote MCP server must use https.");
    }
    if (url.username || url.password) {
      throw new ConnectorStoreError(
        "invalid_request",
        "Put credentials in a header, not in the URL.",
      );
    }
    return { transport: "http", url: url.toString(), ...enabledField(server.enabled) };
  }
  const command = server.command?.trim();
  if (!command)
    throw new ConnectorStoreError("invalid_request", "Enter the command that starts the server.");
  const args = server.args ?? [];
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new ConnectorStoreError("invalid_request", "The command is too long.");
  }
  if (args.length > MAX_ARGS || args.some((arg) => arg.length > MAX_ARG_LENGTH)) {
    throw new ConnectorStoreError(
      "invalid_request",
      `Use at most ${MAX_ARGS} arguments, each under ${MAX_ARG_LENGTH} characters.`,
    );
  }
  return { transport: "stdio", command, args, ...enabledField(server.enabled) };
}

/** Grants name servers by name, so a rename moves them and a removal drops them. */
function renameServerInGrants(
  grants: Record<string, ConnectorGrant> | undefined,
  from: string,
  to: string | null,
): Record<string, ConnectorGrant> | undefined {
  if (!grants || from === to) return grants;
  const next: Record<string, ConnectorGrant> = {};
  for (const [projectId, grant] of Object.entries(grants)) {
    const entry = grant.mcpServers?.[from];
    if (!entry) {
      next[projectId] = grant;
      continue;
    }
    const servers = { ...grant.mcpServers };
    delete servers[from];
    if (to !== null) servers[to] = entry;
    next[projectId] = { ...grant, mcpServers: servers };
  }
  return next;
}

/** Session allows follow a renamed server; a removed one's are dropped. */
function renameServerInAllows(
  allows: Record<string, string[]> | undefined,
  change: { from: string; to: string | null },
): Record<string, string[]> | undefined {
  if (!allows || change.from === change.to) return allows;
  const next: Record<string, string[]> = {};
  for (const [agentId, keys] of Object.entries(allows)) {
    const renamed = renameServerKeys(keys, change) ?? keys;
    if (renamed.length > 0) next[agentId] = renamed;
  }
  return next;
}

export class ConnectorStore {
  private readonly configFile: string;
  private readonly secretsFile: string;
  private readonly sendCountsFile: string;
  private queue: Promise<unknown> = Promise.resolve();
  private config: ConnectorsFile | null = null;
  private secrets: SecretsFile | null = null;
  private configRead: Promise<ConnectorsFile> | null = null;
  private secretsRead: Promise<SecretsFile> | null = null;

  constructor(directory: string) {
    this.configFile = path.join(directory, "connectors.json");
    this.secretsFile = path.join(directory, "secrets.json");
    this.sendCountsFile = path.join(directory, "send-counts.json");
  }

  async projectGrants(): Promise<Record<string, ConnectorGrant>> {
    return (await this.readConfig()).projectGrants ?? {};
  }

  /** `null` forgets the Project's grant. */
  setProjectGrant(projectId: string, grant: ConnectorGrant | null): Promise<void> {
    return this.serialize(async () => {
      const config = await this.readConfig();
      const grants = { ...config.projectGrants };
      if (grant === null) delete grants[projectId];
      else grants[projectId] = grant;
      await this.writeConfig({ ...config, projectGrants: grants });
    });
  }

  async sessionAllows(): Promise<Record<string, string[]>> {
    return (await this.readConfig()).sessionAllows ?? {};
  }

  /** An empty list forgets the session's allows. */
  setSessionAllows(agentId: string, allow: readonly string[]): Promise<void> {
    return this.serialize(async () => {
      const config = await this.readConfig();
      const allows = { ...config.sessionAllows };
      if (allow.length === 0) delete allows[agentId];
      else allows[agentId] = [...new Set(allow)].sort();
      await this.writeConfig({ ...config, sessionAllows: allows });
    });
  }

  /** Sends per Project today, kept across restarts so a restart does not reset a daily limit. */
  sendCounts(): Promise<SendCounts> {
    return this.serialize(async () => {
      const empty = { version: 1 as const, projects: {} };
      return (await readJson(this.sendCountsFile, SendCountsFileSchema, empty)).projects;
    });
  }

  saveSendCounts(projects: SendCounts): Promise<void> {
    return this.serialize(() => writeJsonFileAtomic(this.sendCountsFile, { version: 1, projects }));
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /*
   * Both files are read once and kept: this store is their only writer, and the relay reads the
   * grants on every tool call. A write replaces the kept copy only once the file is written, and
   * the first read never replaces a copy a write already made. Writers edit a copy (`editable`).
   */
  private readConfig(): Promise<ConnectorsFile> {
    if (this.config) return Promise.resolve(this.config);
    this.configRead ??= readJson(this.configFile, ConnectorsFileSchema, { version: 1 }).then(
      (read) => (this.config ??= read),
      (error: unknown) => {
        this.configRead = null;
        throw error;
      },
    );
    return this.configRead;
  }

  private async writeConfig(config: ConnectorsFile): Promise<void> {
    await writeJsonFileAtomic(this.configFile, config);
    this.config = config;
  }

  private readSecrets(): Promise<SecretsFile> {
    if (this.secrets) return Promise.resolve(this.secrets);
    this.secretsRead ??= readJson(this.secretsFile, SecretsFileSchema, { version: 1 }).then(
      (read) => (this.secrets ??= read),
      (error: unknown) => {
        this.secretsRead = null;
        throw error;
      },
    );
    return this.secretsRead;
  }

  /** Copies of both files to change; the kept copies change only once written. */
  private async editable(): Promise<[ConnectorsFile, SecretsFile]> {
    const [config, secrets] = await Promise.all([this.readConfig(), this.readSecrets()]);
    return [structuredClone(config), structuredClone(secrets)];
  }

  private writeSecrets(secrets: SecretsFile): void {
    writePrivateFileAtomicSync(this.secretsFile, JSON.stringify(secrets, null, 2));
    this.secrets = secrets;
  }

  async settings(): Promise<ConnectorSettings> {
    const [config, secrets] = await Promise.all([this.readConfig(), this.readSecrets()]);
    const key = secrets.composioApiKey;
    return {
      composio: {
        configured: Boolean(key),
        ...(key ? { keyHint: `${key.slice(0, 3)}…${key.slice(-4)}` } : {}),
      },
      mcpServers: Object.entries(config.mcpServers ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, record]) => {
          const stored = secrets.mcpServers?.[name];
          return {
            name,
            transport: record.transport,
            url: record.url,
            command: record.command,
            args: record.args,
            enabled: record.enabled === false ? false : undefined,
            headerKeys: Object.keys(stored?.headers ?? {}).sort(),
            envKeys: Object.keys(stored?.env ?? {}).sort(),
          };
        }),
    };
  }

  async composioApiKey(): Promise<string | undefined> {
    return (await this.readSecrets()).composioApiKey;
  }

  async composioIdentity(): Promise<{ userId?: string; sessionId?: string }> {
    return (await this.readConfig()).composio ?? {};
  }

  /** Stores the key and the session made with it; `null` forgets both. */
  setComposio(input: { apiKey: string; userId: string; sessionId: string } | null): Promise<void> {
    return this.serialize(async () => {
      const [config, secrets] = await this.editable();
      if (input === null) {
        delete secrets.composioApiKey;
        // The user id stays: a later key for the same Composio project finds its accounts again.
        config.composio = config.composio?.userId ? { userId: config.composio.userId } : undefined;
      } else {
        secrets.composioApiKey = input.apiKey;
        config.composio = { userId: input.userId, sessionId: input.sessionId };
      }
      this.writeSecrets(secrets);
      await this.writeConfig(config);
    });
  }

  async mcpServer(
    name: string,
  ): Promise<{ record: McpServerRecord; secrets: McpServerSecrets } | null> {
    const [config, secrets] = await Promise.all([this.readConfig(), this.readSecrets()]);
    const record = config.mcpServers?.[name];
    if (!record) return null;
    const stored = secrets.mcpServers?.[name];
    return { record, secrets: { headers: stored?.headers ?? {}, env: stored?.env ?? {} } };
  }

  saveMcpServer(input: McpServerSaveInput): Promise<void> {
    return this.serialize(async () => {
      const [config, secrets] = await this.editable();
      const record = validateServer(input.server);
      const servers = { ...config.mcpServers };
      const name = input.server.name;
      const previous = input.previousName ?? name;
      if (previous !== name && servers[name]) {
        throw new ConnectorStoreError("conflict", `An MCP server named "${name}" already exists.`);
      }
      if (!servers[previous] && Object.keys(servers).length >= MAX_MCP_SERVERS) {
        throw new ConnectorStoreError(
          "conflict",
          `A Host holds at most ${MAX_MCP_SERVERS} MCP servers.`,
        );
      }
      const storedSecrets = { ...secrets.mcpServers };
      // Secrets count only for a server that exists; any left by a crash are not inherited.
      const current = servers[previous] ? storedSecrets[previous] : undefined;
      // A save that does not say on or off keeps the server as it was.
      const keepOff = input.server.enabled === undefined && servers[previous]?.enabled === false;
      delete servers[previous];
      servers[name] = keepOff ? { ...record, enabled: false } : record;
      const http = record.transport === "http";
      storedSecrets[name] = {
        headers: http ? applySecretPatch("header", current?.headers, input.headers) : {},
        env: http ? {} : applySecretPatch("env", current?.env, input.env),
      };
      // Two files: the secrets first, still under the old name too, so a crash between the
      // writes leaves whichever name connectors.json holds with its secrets.
      this.writeSecrets({ ...secrets, mcpServers: storedSecrets });
      const projectGrants = renameServerInGrants(config.projectGrants, previous, name);
      const sessionAllows = renameServerInAllows(config.sessionAllows, {
        from: previous,
        to: name,
      });
      await this.writeConfig({ ...config, mcpServers: servers, projectGrants, sessionAllows });
      if (previous !== name) {
        delete storedSecrets[previous];
        this.writeSecrets({ ...secrets, mcpServers: storedSecrets });
      }
    });
  }

  removeMcpServer(name: string): Promise<void> {
    return this.serialize(async () => {
      const [config, secrets] = await this.editable();
      if (!config.mcpServers?.[name]) {
        throw new ConnectorStoreError("not_found", `There is no MCP server named "${name}".`);
      }
      const servers = { ...config.mcpServers };
      const storedSecrets = { ...secrets.mcpServers };
      delete servers[name];
      delete storedSecrets[name];
      // A later server with the same name must not inherit this one's grants. The config goes
      // first: a crash before the secrets write leaves only unused secrets behind.
      const projectGrants = renameServerInGrants(config.projectGrants, name, null);
      const sessionAllows = renameServerInAllows(config.sessionAllows, { from: name, to: null });
      await this.writeConfig({ ...config, mcpServers: servers, projectGrants, sessionAllows });
      this.writeSecrets({ ...secrets, mcpServers: storedSecrets });
    });
  }
}

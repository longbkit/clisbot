import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Logger } from "pino";
import {
  CONNECTOR_APP_SLUG_PATTERN,
  type ConnectorAppState,
  type ConnectorErrorCode,
  type ConnectorGrant,
  type ConnectorSettings,
  type ProjectConnectorGrant,
  type ConnectorTool,
} from "@clisbot/protocol/connectors/types";
import { ConnectorCatalog, type CatalogQuery } from "./connector-catalog.js";
import { checkConnectorGrant } from "./connector-grant-rules.js";
import { ConnectorStore, ConnectorStoreError, type McpServerSaveInput } from "./connector-store.js";
import { classifyConnectorTool, type ConnectorToolHints } from "./connector-tool-kind.js";
import {
  ComposioClient,
  ComposioError,
  isComposioUrl,
  sessionCoversAuthConfigs,
  type AuthConfigMap,
  type ComposioAccount,
  type ComposioCatalogPage,
  type ComposioFetch,
  type ComposioSession,
  type ComposioToolInfo,
} from "./composio-client.js";
import { listMcpServerTools } from "./mcp-server-probe.js";
import type { ConnectorsConfig } from "./connectors-config.js";
import { getErrorMessage } from "@clisbot/protocol/error-utils";

/**
 * Connectors on one Host (docs/features/connectors/README.md): the Composio key and session,
 * the app catalog, connected accounts, and the MCP servers the user added. RPC handlers and
 * the relay both go through this service; nothing else touches the store.
 */

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * No app, no server, Codex's own apps left on and the Host's tool settings followed: the same as
 * having no grant.
 */
function grantIsEmpty(grant: ConnectorGrant): boolean {
  const apps = Object.keys(grant.apps ?? {}).length;
  const servers = Object.keys(grant.mcpServers ?? {}).length;
  const ownChoice = grant.agentTools !== undefined || grant.browserTools !== undefined;
  return apps === 0 && servers === 0 && grant.builtInApps !== false && !ownChoice;
}

/** Composio lists 1,000 apps a page; this bounds a catalog that never ends its cursor. */
const MAX_CATALOG_PAGES = 20;

export interface AgentToolDefaults {
  agentTools: boolean;
  browserTools: boolean;
}

export interface McpServerChange {
  from: string;
  to: string | null;
}

interface ComposioSessionUse {
  client: ComposioClient;
  session: ComposioSession;
  userId: string;
}

/** How long Composio's answers are kept: accounts briefly, the catalog's slugs like its pages. */
const ANSWER_TTL = { accounts: 15_000, slugs: 10 * 60_000 } as const;

export class ConnectorRequestError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorRequestError";
  }
}

const MAX_ACCOUNTS_PER_APP = 5;
const ALIAS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,63}$/u;
const UNUSABLE_STATUS = /^(INITIATED|INITIALIZING|PENDING|EXPIRED|FAILED)$/;

export interface ConnectorServiceOptions {
  config: ConnectorsConfig;
  clisbotHome: string;
  logger: Logger;
  fetch?: ComposioFetch;
}

function toRequestError(error: unknown): unknown {
  if (error instanceof ConnectorStoreError)
    return new ConnectorRequestError(error.code, error.message);
  if (error instanceof ComposioError) {
    if (error.status === 401) {
      return new ConnectorRequestError(
        "composio_rejected",
        `Composio refused the key: ${error.message}`,
      );
    }
    if (error.status === 403) {
      return new ConnectorRequestError(
        "composio_rejected",
        `Composio does not allow this with the saved key: ${error.message}`,
      );
    }
    if (error.status === 404) return new ConnectorRequestError("not_found", error.message);
    if (error.status >= 500 || error.status === 429) {
      return new ConnectorRequestError(
        "upstream_unavailable",
        `Composio is unavailable: ${error.message}`,
      );
    }
    return new ConnectorRequestError("invalid_request", error.message);
  }
  return error;
}

async function translated<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toRequestError(error);
  }
}

function groupAccounts(accounts: ComposioAccount[]): ConnectorAppState[] {
  const bySlug = new Map<string, ConnectorAppState>();
  for (const { slug, ...account } of accounts) {
    const app = bySlug.get(slug) ?? { slug, accounts: [] };
    app.accounts.push(account);
    bySlug.set(slug, app);
  }
  return [...bySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

function hintsOf(tool: { readOnly?: boolean }): ConnectorToolHints {
  return tool.readOnly === undefined ? {} : { readOnly: tool.readOnly };
}

/** Composio's apps as the relay needs them (`ConnectorService.catalogApps`). */
export interface CatalogApps {
  slugs: string[];
  /** Each app's name as Composio shows it ("Google Calendar"), by slug. */
  names: ReadonlyMap<string, string>;
  /** Each app's logo, by slug, when Composio has one. */
  logos: ReadonlyMap<string, string>;
  /** Apps that run without a connected account (Hacker News); no connect card for them. */
  noAuth: ReadonlySet<string>;
}

/**
 * A key must read Composio's app list (Toolkits: Read): browsing apps and telling which app a tool
 * belongs to both need it, and a scoped key without it would leave every app tool refused.
 */
async function requireCatalogAccess(client: ComposioClient): Promise<void> {
  try {
    await client.listToolkits({ limit: 1 });
  } catch (error) {
    if (error instanceof ComposioError && error.status === 403) {
      throw new ConnectorRequestError(
        "invalid_request",
        "This key may not read Composio's app list. Create a key with full access, or a scoped key with Toolkits: Read.",
      );
    }
    throw toRequestError(error);
  }
}

export class ConnectorService {
  readonly store: ConnectorStore;
  private readonly config: ConnectorsConfig;
  private readonly logger: Logger;
  private readonly fetchImpl: ComposioFetch | undefined;
  private readonly catalog = new ConnectorCatalog();
  /** Every account of the Host's Composio user, kept briefly: the relay checks them per call. */
  private accountsCache: { at: number; accounts: ComposioAccount[] } | null = null;
  private appsCache: (CatalogApps & { at: number }) | null = null;
  private readonly appToolsCache = new Map<
    string,
    { at: number; tools: Promise<ComposioToolInfo[]> }
  >();
  /** The session being made or checked now, per `recheckAuthConfigs`. */
  private readonly sessionLoads = new Map<boolean, Promise<ComposioSessionUse>>();
  private session: ComposioSession | null = null;
  private readonly probes = new Map<string, Promise<ConnectorTool[]>>();
  private serverChanged: (change: McpServerChange) => void = () => undefined;
  private readAgentToolDefaults: () => AgentToolDefaults = () => ({
    agentTools: false,
    browserTools: false,
  });
  /** Sessions created for a set of auth configs; Composio may not echo them back. */
  private readonly authConfigAttempts = new Set<string>();

  constructor(options: ConnectorServiceOptions) {
    this.config = options.config;
    this.logger = options.logger.child({ module: "connectors" });
    this.fetchImpl = options.fetch;
    this.store = new ConnectorStore(path.join(options.clisbotHome, "connectors"));
  }

  get composioApiUrl(): string {
    return this.config.composioApiUrl;
  }

  /** Forgets what Composio said, after the key or the accounts change. */
  private forgetComposioAnswers(): void {
    this.accountsCache = null;
    this.appsCache = null;
    this.appToolsCache.clear();
  }

  settings(): Promise<ConnectorSettings> {
    return this.store.settings();
  }

  private clientFor(apiKey: string): ComposioClient {
    return new ComposioClient({
      apiUrl: this.config.composioApiUrl,
      apiKey,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
  }

  /** The Composio client for the stored key, or null when none is saved. */
  async composio(): Promise<ComposioClient | null> {
    const key = await this.store.composioApiKey();
    return key ? this.clientFor(key) : null;
  }

  private async requireComposio(): Promise<ComposioClient> {
    const client = await this.composio();
    if (!client) {
      throw new ConnectorRequestError(
        "composio_not_configured",
        "Save a Composio API key in Connectors first.",
      );
    }
    return client;
  }

  /** Checks a key by making a session with it, then stores both. `null` forgets the key. */
  async setComposioKey(apiKey: string | null): Promise<ConnectorSettings> {
    if (apiKey === null) {
      await this.store.setComposio(null);
      this.session = null;
      this.catalog.clear();
      this.forgetComposioAnswers();
      return this.store.settings();
    }
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith("ak_") || trimmed.length < 8) {
      throw new ConnectorRequestError(
        "invalid_request",
        "A Composio project API key starts with ak_.",
      );
    }
    const client = this.clientFor(trimmed);
    await requireCatalogAccess(client);
    const identity = await this.store.composioIdentity();
    const userId = identity.userId ?? `clisbot_${randomBytes(8).toString("hex")}`;
    const session = await this.newSession(client, userId, trimmed);
    this.session = session;
    this.catalog.clear();
    this.forgetComposioAnswers();
    this.logger.info({ userId }, "Composio key saved");
    return this.store.settings();
  }

  private assertTrustedSession(session: ComposioSession): void {
    if (!isComposioUrl(session.mcp.url, this.config.composioApiUrl)) {
      throw new ConnectorRequestError(
        "upstream_unavailable",
        "Composio returned a session address outside composio.dev; Clisbot will not send the key there.",
      );
    }
  }

  /**
   * The Host's session, recreated with the same Composio user when Composio dropped it or when
   * the project gained its own auth config for an app (a session names its auth configs once,
   * at creation). `recheckAuthConfigs` reads them again even for a session already in use.
   */
  composioSession(options: { recheckAuthConfigs?: boolean } = {}): Promise<ComposioSessionUse> {
    // Agents resumed at boot all ask at once; one of them makes the session, the rest wait for it.
    const recheck = options.recheckAuthConfigs === true;
    const running = this.sessionLoads.get(recheck);
    if (running) return running;
    const load = this.loadComposioSession(recheck).finally(() => this.sessionLoads.delete(recheck));
    this.sessionLoads.set(recheck, load);
    return load;
  }

  private async loadComposioSession(recheckAuthConfigs: boolean): Promise<ComposioSessionUse> {
    const client = await this.requireComposio();
    const identity = await this.store.composioIdentity();
    const userId = identity.userId;
    if (!userId)
      throw new ConnectorRequestError("composio_not_configured", "Save the Composio key again.");
    const cached = this.session?.session_id === identity.sessionId ? this.session : null;
    if (cached && !recheckAuthConfigs) return { client, session: cached, userId };
    const wanted = await customAuthConfigs(client);
    const existing =
      cached ??
      (identity.sessionId ? await translated(() => client.getSession(identity.sessionId!)) : null);
    const fits =
      existing !== null &&
      (sessionCoversAuthConfigs(existing, wanted) ||
        this.authConfigAttempts.has(attemptKey(existing.session_id, wanted)));
    const session = fits ? existing : await this.newSession(client, userId, null, wanted);
    this.assertTrustedSession(session);
    this.session = session;
    return { client, session, userId };
  }

  /** A new session for the Composio user; stores its id with the key (`apiKey` when new). */
  private async newSession(
    client: ComposioClient,
    userId: string,
    apiKey: string | null,
    known?: AuthConfigMap,
  ): Promise<ComposioSession> {
    const wanted = known ?? (await customAuthConfigs(client));
    const session = await translated(() => client.createSession(userId, wanted));
    this.assertTrustedSession(session);
    this.authConfigAttempts.add(attemptKey(session.session_id, wanted));
    const key = apiKey ?? (await this.store.composioApiKey());
    if (key) await this.store.setComposio({ apiKey: key, userId, sessionId: session.session_id });
    if (Object.keys(wanted).length) {
      this.logger.info(
        { apps: Object.keys(wanted) },
        "Composio session uses the project's own sign-in",
      );
    }
    return session;
  }

  /**
   * Every app in Composio's catalog: its slugs, so a tool such as `ZOHO_MAIL_SEND_EMAIL` is
   * matched to `zoho_mail` and not to a granted `zoho`, and the apps that need no sign-in. Null
   * when the catalog cannot be read in full: the caller then refuses app tools rather than match
   * them on the grant's slugs alone.
   */
  async catalogApps(): Promise<CatalogApps | null> {
    if (this.appsCache && Date.now() - this.appsCache.at < ANSWER_TTL.slugs) return this.appsCache;
    const slugs: string[] = [];
    const noAuth = new Set<string>();
    const names = new Map<string, string>();
    const logos = new Map<string, string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
        const result = await this.catalogPage(cursor ? { cursor } : {});
        for (const item of result.items) {
          slugs.push(item.slug);
          names.set(item.slug, item.name);
          if (item.logo) logos.set(item.slug, item.logo);
          if (item.noAuth) noAuth.add(item.slug);
        }
        if (!result.nextCursor || result.nextCursor === cursor) {
          this.appsCache = { at: Date.now(), slugs, names, logos, noAuth };
          return this.appsCache;
        }
        cursor = result.nextCursor;
      }
    } catch {
      // Composio unreachable or refused the read.
    }
    return null;
  }

  async catalogPage(query: CatalogQuery): Promise<ComposioCatalogPage> {
    const client = await this.composio();
    return translated(() => this.catalog.page(client, query));
  }

  /**
   * Accounts per app. The relay reads them on every tool call, so the Host's whole list is kept
   * for a few seconds; `fresh` asks Composio now, as the connect card does while it waits.
   */
  async accounts(
    slugs?: readonly string[],
    options: { fresh?: boolean } = {},
  ): Promise<ConnectorAppState[]> {
    const client = await this.composio();
    if (!client) return [];
    const identity = await this.store.composioIdentity();
    if (!identity.userId) return [];
    const wanted = slugs?.filter((slug) => CONNECTOR_APP_SLUG_PATTERN.test(slug));
    if (options.fresh) {
      return groupAccounts(await translated(() => client.listAccounts(identity.userId!, wanted)));
    }
    if (!this.accountsCache || Date.now() - this.accountsCache.at > ANSWER_TTL.accounts) {
      const all = await translated(() => client.listAccounts(identity.userId!));
      this.accountsCache = { at: Date.now(), accounts: all };
    }
    const kept = this.accountsCache.accounts;
    return groupAccounts(wanted ? kept.filter((account) => wanted.includes(account.slug)) : kept);
  }

  /** The aliases of one app's accounts decide whether a new sign-in needs a name. */
  private chooseAlias(
    accounts: ConnectorAppState["accounts"],
    alias: string | undefined,
  ): string | undefined {
    const usable = accounts.filter((account) => !UNUSABLE_STATUS.test(account.status));
    if (usable.length >= MAX_ACCOUNTS_PER_APP) {
      throw new ConnectorRequestError(
        "conflict",
        `An app holds at most ${MAX_ACCOUNTS_PER_APP} accounts.`,
      );
    }
    if (alias !== undefined) {
      if (!ALIAS_PATTERN.test(alias)) {
        throw new ConnectorRequestError(
          "invalid_request",
          "An account name is 1–64 letters, digits or . _ @ -.",
        );
      }
      if (accounts.some((account) => account.alias?.toLowerCase() === alias.toLowerCase())) {
        throw new ConnectorRequestError("conflict", `An account named "${alias}" already exists.`);
      }
      return alias;
    }
    if (accounts.length === 0) return undefined;
    if (usable.length === 0) return `retry-${randomBytes(3).toString("hex")}`;
    throw new ConnectorRequestError(
      "invalid_request",
      "Name the new account (for example work) so it does not replace the one already connected.",
    );
  }

  async connect(slug: string, alias?: string): Promise<string> {
    if (!CONNECTOR_APP_SLUG_PATTERN.test(slug)) {
      throw new ConnectorRequestError("invalid_request", `"${slug}" is not an app.`);
    }
    const { client, session, userId } = await this.composioSession({ recheckAuthConfigs: true });
    const named = alias?.trim() || undefined;
    const existing = await accountsOrUnknown(() => client.listAccounts(userId, [slug]));
    // A key scoped away from listing accounts cannot check names; Composio still links.
    // Composio's filter is not trusted: only this app's accounts decide whether a name is needed.
    const own = existing?.filter((account) => account.slug === slug) ?? null;
    const chosen = own === null ? named : this.chooseAlias(own, named);
    const url = await translated(() => linkFor(client, session.session_id, slug, chosen));
    if (!isComposioUrl(url, this.config.composioApiUrl)) {
      throw new ConnectorRequestError(
        "upstream_unavailable",
        "Composio returned a sign-in link outside composio.dev; Clisbot will not open it.",
      );
    }
    this.accountsCache = null;
    return url;
  }

  async removeAccount(accountId: string): Promise<void> {
    const { client, userId } = await this.composioSession();
    const owned = await translated(() => client.listAccounts(userId));
    if (!owned.some((account) => account.id === accountId)) {
      throw new ConnectorRequestError("not_found", "That account is not connected on this Host.");
    }
    await translated(() => client.removeAccount(accountId));
    this.accountsCache = null;
  }

  async projectGrants(): Promise<ProjectConnectorGrant[]> {
    const grants = await this.store.projectGrants();
    return Object.entries(grants).map(([projectId, grant]) => ({ projectId, grant }));
  }

  async setProjectGrant(
    projectId: string,
    grant: ConnectorGrant | null,
  ): Promise<ConnectorGrant | null> {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ConnectorRequestError("invalid_request", "That is not a Project id.");
    }
    if (grant !== null) {
      try {
        checkConnectorGrant(grant);
      } catch (error) {
        throw new ConnectorRequestError("invalid_request", (error as Error).message);
      }
    }
    // A grant naming nothing and changing nothing is no grant: the Project's entry goes.
    const stored = grant !== null && grantIsEmpty(grant) ? null : grant;
    await translated(() => this.store.setProjectGrant(projectId, stored));
    return stored;
  }

  sessionAllows(): Promise<Record<string, string[]>> {
    return this.store.sessionAllows();
  }

  /** The tools one session may use beyond its Project's grant; the app writes the whole list. */
  async setSessionAllows(agentId: string, allow: readonly string[]): Promise<string[] | null> {
    if (
      !agentId ||
      allow.some((key) => key.length === 0 || key.length > 256 || key.includes(","))
    ) {
      throw new ConnectorRequestError("invalid_request", "That is not a list of tools.");
    }
    await translated(() => this.store.setSessionAllows(agentId, allow));
    return allow.length > 0 ? [...new Set(allow)].sort() : null;
  }

  async saveMcpServer(input: McpServerSaveInput): Promise<ConnectorSettings> {
    await translated(() => this.store.saveMcpServer(input));
    this.serverChanged({ from: input.previousName ?? input.server.name, to: input.server.name });
    return this.store.settings();
  }

  async removeMcpServer(name: string): Promise<ConnectorSettings> {
    await translated(() => this.store.removeMcpServer(name));
    this.serverChanged({ from: name, to: null });
    return this.store.settings();
  }

  /** What a Project without its own choice gets: the Host's agent tool settings now. */
  setAgentToolDefaults(read: () => AgentToolDefaults): void {
    this.readAgentToolDefaults = read;
  }

  agentToolDefaults(): AgentToolDefaults {
    return this.readAgentToolDefaults();
  }

  /** Called once a server is saved (`to` its name now) or removed (`to: null`). */
  onMcpServerChanged(handler: (change: McpServerChange) => void): void {
    this.serverChanged = handler;
  }

  /** An app's tools with Composio's hints, kept briefly: the relay reads them on every call. */
  private appTools(slug: string): Promise<ComposioToolInfo[]> {
    const cached = this.appToolsCache.get(slug);
    if (cached && Date.now() - cached.at < ANSWER_TTL.slugs) return cached.tools;
    const tools = this.requireComposio().then((client) => translated(() => client.listTools(slug)));
    // A failed read is not kept.
    tools.catch(() => {
      if (this.appToolsCache.get(slug)?.tools === tools) this.appToolsCache.delete(slug);
    });
    this.appToolsCache.set(slug, { at: Date.now(), tools });
    return tools;
  }

  /**
   * What each of an app's tools says about itself, by tool name. Empty when Composio does not
   * list them (a key without Tools: Read): the tool's name then decides alone.
   */
  async toolHints(slug: string): Promise<ReadonlyMap<string, ConnectorToolHints>> {
    try {
      return new Map((await this.appTools(slug)).map((tool) => [tool.name, hintsOf(tool)]));
    } catch {
      return new Map();
    }
  }

  async tools(target: { app?: string; mcpServer?: string }): Promise<ConnectorTool[]> {
    if (target.app) {
      const slug = target.app;
      if (!CONNECTOR_APP_SLUG_PATTERN.test(slug)) {
        throw new ConnectorRequestError("invalid_request", `"${slug}" is not an app.`);
      }
      const tools = await this.appTools(slug);
      return tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        kind: classifyConnectorTool(tool.name, slug, hintsOf(tool)),
      }));
    }
    if (target.mcpServer) return this.serverTools(target.mcpServer);
    throw new ConnectorRequestError("invalid_request", "Name an app or an MCP server.");
  }

  /**
   * Lists a server's tools by starting it (a local command) or calling it with its stored
   * headers. One probe per server runs at a time; callers asking meanwhile share its answer.
   */
  private serverTools(name: string): Promise<ConnectorTool[]> {
    const running = this.probes.get(name);
    if (running) return running;
    const probe = this.probeServer(name).finally(() => this.probes.delete(name));
    this.probes.set(name, probe);
    return probe;
  }

  private async probeServer(name: string): Promise<ConnectorTool[]> {
    const server = await this.store.mcpServer(name);
    if (!server) {
      throw new ConnectorRequestError("not_found", `There is no MCP server named "${name}".`);
    }
    try {
      const tools = await listMcpServerTools({ ...server.record, secrets: server.secrets });
      return tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        kind: classifyConnectorTool(tool.name, undefined, hintsOf(tool)),
      }));
    } catch (error) {
      throw new ConnectorRequestError(
        "upstream_unavailable",
        `Could not reach "${name}": ${getErrorMessage(error)}`,
      );
    }
  }
}

function attemptKey(sessionId: string, wanted: AuthConfigMap): string {
  return `${sessionId}:${JSON.stringify(wanted)}`;
}

/** The project's own auth configs; a key that may not list them has none Clisbot can use. */
async function customAuthConfigs(client: ComposioClient): Promise<AuthConfigMap> {
  return client.listCustomAuthConfigs().catch((): AuthConfigMap => ({}));
}

/** The accounts, or null when the key may not list them. */
async function accountsOrUnknown(
  list: () => Promise<ComposioAccount[]>,
): Promise<ComposioAccount[] | null> {
  try {
    return await list();
  } catch (error) {
    if (error instanceof ComposioError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw toRequestError(error);
  }
}

/** A sign-in link; an app Composio has no managed sign-in for says what the person must do. */
async function linkFor(
  client: ComposioClient,
  sessionId: string,
  slug: string,
  alias: string | undefined,
): Promise<string> {
  try {
    return await client.link(sessionId, slug, alias);
  } catch (error) {
    if (error instanceof ComposioError && /auth[\s_-]?config/i.test(error.message)) {
      throw new ConnectorRequestError(
        "invalid_request",
        `Composio has no ready-made sign-in for ${slug}. Create an auth config for it in your Composio project (platform.composio.dev → Auth Configs), then connect again.`,
      );
    }
    throw error;
  }
}

export function createConnectorServiceFromConfig(
  config: ConnectorsConfig | undefined,
  options: Omit<ConnectorServiceOptions, "config">,
): ConnectorService | null {
  return config?.enabled ? new ConnectorService({ ...options, config }) : null;
}

import { createHash, randomBytes } from "node:crypto";
import {
  connectorAppTitle,
  connectorEnabledApps,
  connectorEnabledServers,
  connectorSendPolicyOf,
  DEFAULT_CONNECTOR_DAILY_SEND_LIMIT,
  MAX_CONNECTOR_DAILY_SEND_LIMIT,
  connectorOffKey,
  CONNECTOR_CARD_METADATA,
  type ConnectorCard,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  McpServerConfig,
} from "../agent/agent-sdk-types.js";
import type { RuntimeMcpServers } from "../agent/agent-manager.js";
import type { SendCounts } from "./connector-store.js";
import { actionWords } from "./connector-tool-kind.js";
import {
  entryToolSlug,
  PREAPPROVED_COMPOSIO_TOOLS,
  type ConnectorTargetTool,
} from "./connector-verdict.js";
import { SendApprovals } from "./connector-approvals.js";
import { ConnectorConnectFlow, type ConnectFlowDeps } from "./connector-connect.js";
import type { CatalogApps, ConnectorService } from "./connector-service.js";
import { sendCardFields } from "./connector-send-card.js";
import { isRecord } from "./connector-json.js";

/**
 * What ties a running agent to its Project's Connectors (docs/features/connectors/README.md,
 * "Runtime"): the MCP entries an agent session gets, the capability token that names the
 * agent to the relay, the send approvals and the daily send count. A Bot is a Project, so its
 * Chats, Schedules and Routes get the Bot's Connectors the same way.
 */

/** Reserved MCP server names; `stripRuntimeMcpServers` removes them before persisting. */
export const CONNECTORS_MCP_PREFIX = "connectors_";
const COMPOSIO_MCP_SERVER_NAME = `${CONNECTORS_MCP_PREFIX}composio`;
export const CONNECTORS_RELAY_ROUTE = "/mcp/connectors";

/** The slice of AgentManager the runtime needs; a test passes its own. */
export interface ConnectorPermissionHost {
  requestDaemonPermission(
    agentId: string,
    request: Omit<AgentPermissionRequest, "provider">,
  ): Promise<AgentPermissionResponse>;
  /** Closes a request the daemon raised, for example once the account it waited for exists. */
  resolveDaemonPermission?(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void>;
}

export interface ConnectorProject {
  projectId: string;
  rootPath: string;
}

/** Where agent sessions belong; `connector-projects.ts` builds it from the registries. */
export interface ConnectorProjectDirectory {
  /** The active Project one of whose Workspaces runs in this directory. */
  projectForCwd(cwd: string): Promise<ConnectorProject | null>;
  /** The Project while it is active: not archived, and not the home of an archived Bot. */
  project(projectId: string): Promise<ConnectorProject | null>;
  /** The agent's labels now. */
  agentLabels(agentId: string): Record<string, string> | undefined;
  /**
   * What the session leaves off now: its own label, and the list of the Chat it is a Bot's
   * session in. Read on every call.
   */
  offList(agentId: string): Promise<Set<string>>;
  /** Whose allows apply to the session: its own, and its Chat's when it is a Bot's in one. */
  allowOwners(agentId: string): string[];
  /** The folder the agent runs in, which decides its Project. */
  agentCwd(agentId: string): string | undefined;
  /**
   * `active` while the agent may call, `closed` once it was closed or archived (its token is
   * refused until it runs again), `gone` when the daemon no longer knows it (its token is dropped).
   */
  agentState(agentId: string): "active" | "closed" | "gone";
}

export interface AgentTicket {
  agentId: string;
  projectId: string;
}

/**
 * `waited`: the person was asked, so the call may run minutes after the grant was read.
 * `approvalKey`: the Allow this call took; `keepApproval` puts it back when the call is not sent.
 */
export type SendDecision =
  | { allowed: true; waited?: boolean; approvalKey?: string }
  | { allowed: false; message: string };

/** Tokens are looked up by their hash, so one lookup is enough and no token leaks by timing. */
function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function hasAnyGrant(grant: ConnectorGrant | undefined): grant is ConnectorGrant {
  return connectorEnabledApps(grant).length > 0 || connectorEnabledServers(grant).length > 0;
}

/** The Project's grant with the apps and servers this session turned off paused. */
function sessionGrant(
  grant: ConnectorGrant | undefined,
  off: ReadonlySet<string>,
): ConnectorGrant | undefined {
  if (!grant || off.size === 0) return grant;
  const pause = <T extends { enabled?: boolean }>(
    entries: Record<string, T>,
    key: (name: string) => string,
  ) =>
    Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [
        name,
        off.has(key(name)) ? { ...entry, enabled: false } : entry,
      ]),
    );
  return {
    ...grant,
    ...(grant.apps ? { apps: pause(grant.apps, (app) => connectorOffKey({ app })) } : {}),
    ...(grant.mcpServers
      ? { mcpServers: pause(grant.mcpServers, (mcpServer) => connectorOffKey({ mcpServer })) }
      : {}),
  };
}

export class ConnectorRuntime {
  /** Token hash → the agent it names; the token itself, to give the same one at relaunch. */
  private readonly tickets = new Map<string, AgentTicket>();
  private readonly tokens = new Map<string, string>();
  /** Agent → its token hash. */
  private readonly ticketKeys = new Map<string, string>();
  private readonly approvals: SendApprovals;
  private readonly sendCounts = new Map<string, { day: string; count: number }>();
  private sendCountsLoaded: Promise<void> | null = null;
  private relayBaseUrl: string | null = null;
  private permissionHost: ConnectorPermissionHost | null = null;

  /** The connect card; the relay asks it before a call to an app with no working account. */
  readonly connect: ConnectorConnectFlow;

  constructor(
    readonly service: ConnectorService,
    private readonly projects: ConnectorProjectDirectory,
    private readonly now: () => Date = () => new Date(),
    connectOptions: Omit<ConnectFlowDeps, "service" | "host"> = {},
  ) {
    this.approvals = new SendApprovals(() => this.now().getTime());
    this.connect = new ConnectorConnectFlow({
      ...connectOptions,
      service,
      host: () => this.permissionHost,
    });
  }

  /** Set once the daemon listens; null keeps agents without Connectors. */
  setRelayBaseUrl(url: string | null): void {
    this.relayBaseUrl = url;
  }

  setPermissionHost(host: ConnectorPermissionHost): void {
    this.permissionHost = host;
  }

  private tokenFor(agentId: string, projectId: string): string {
    this.pruneTickets();
    const existing = this.ticketKeys.get(agentId);
    if (existing && this.tickets.get(existing)?.projectId === projectId) {
      return this.tokens.get(existing)!;
    }
    this.forgetAgent(agentId);
    const token = randomBytes(32).toString("base64url");
    const key = tokenKey(token);
    this.tickets.set(key, { agentId, projectId });
    this.tokens.set(key, token);
    this.ticketKeys.set(agentId, key);
    return token;
  }

  /**
   * The agent a bearer token names while that agent may call, or null. A closed agent keeps its
   * token, refused until the agent runs again under the same launch config; a deleted one loses it.
   */
  ticketFor(authorizationHeader: string | undefined): AgentTicket | null {
    const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
    if (!match) return null;
    const ticket = this.tickets.get(tokenKey(match[1]!.trim()));
    if (!ticket) return null;
    const state = this.projects.agentState(ticket.agentId);
    if (state === "gone") this.forgetAgent(ticket.agentId);
    return state === "active" ? ticket : null;
  }

  /** Drops the tokens of agents the daemon no longer knows. */
  private pruneTickets(): void {
    for (const ticket of this.tickets.values()) {
      if (this.projects.agentState(ticket.agentId) === "gone") this.forgetAgent(ticket.agentId);
    }
  }

  private forgetAgent(agentId: string): void {
    const key = this.ticketKeys.get(agentId);
    if (key === undefined) return;
    this.tickets.delete(key);
    this.tokens.delete(key);
    this.ticketKeys.delete(agentId);
  }

  /** The Project's Clisbot tools choice, as a launch reads it, minting no token. */
  async clisbotToolsChoice(cwd: string | undefined): Promise<boolean | undefined> {
    return (await this.grantForCwd(cwd))?.grant?.agentTools?.enabled;
  }

  /** The Project running in `cwd` and its grant; null when no Project has a grant. */
  private async grantForCwd(
    cwd: string | undefined,
  ): Promise<{ project: ConnectorProject | null; grant: ConnectorGrant | undefined } | null> {
    const grants = await this.service.store.projectGrants();
    if (!cwd || Object.keys(grants).length === 0) return null;
    const project = await this.projects.projectForCwd(cwd);
    return { project, grant: project ? grants[project.projectId] : undefined };
  }

  /**
   * The MCP servers an agent session gets for its Project's grant; empty outside a Project with
   * Connectors. Servers follow the Project's grant, not the session's off list: the relay applies
   * that list on every call, so turning one back on mid-session works. Composio's meta-tools need
   * no prompt: the relay checks each call against the grant and asks before sends. Tools of the
   * person's own MCP servers keep the agent's prompts.
   */
  async mcpServersForAgent(params: { agentId: string; cwd?: string }): Promise<RuntimeMcpServers> {
    const found = await this.grantForCwd(params.cwd);
    if (!found) return this.noConnectors(params.agentId);
    const { project, grant } = found;
    const choice = grant?.agentTools?.enabled;
    const result: RuntimeMcpServers = {
      servers: {},
      preapproved: [],
      ...(grant?.builtInApps === false ? { builtInApps: false } : {}),
      ...(choice === undefined ? {} : { clisbotTools: choice }),
    };
    if (!this.relayBaseUrl || !project || !hasAnyGrant(grant)) {
      this.forgetAgent(params.agentId);
      return result;
    }
    const authorization = {
      Authorization: `Bearer ${this.tokenFor(params.agentId, project.projectId)}`,
    };
    if (connectorEnabledApps(grant).length > 0 && (await this.service.store.composioApiKey())) {
      result.servers[COMPOSIO_MCP_SERVER_NAME] = {
        type: "http",
        url: `${this.relayBaseUrl}/composio`,
        headers: authorization,
      };
      result.preapproved.push(
        ...PREAPPROVED_COMPOSIO_TOOLS.map((tool) => ({ server: COMPOSIO_MCP_SERVER_NAME, tool })),
      );
    }
    for (const name of connectorEnabledServers(grant)) {
      const entry = await this.serverEntry(name, authorization);
      if (entry) result.servers[`${CONNECTORS_MCP_PREFIX}${name}`] = entry;
    }
    return result;
  }

  /** A launch without Connectors also ends a token an earlier launch of this agent held. */
  private noConnectors(agentId: string): RuntimeMcpServers {
    this.forgetAgent(agentId);
    return { servers: {}, preapproved: [] };
  }

  private async serverEntry(
    name: string,
    authorization: Record<string, string>,
  ): Promise<McpServerConfig | null> {
    const stored = await this.service.store.mcpServer(name);
    if (!stored || stored.record.enabled === false) return null;
    return {
      type: "http",
      url: `${this.relayBaseUrl}/server/${encodeURIComponent(name)}`,
      headers: authorization,
    };
  }

  /** Where a Project's local MCP servers run: its root folder. */
  async projectHome(projectId: string): Promise<string | undefined> {
    return (await this.projects.project(projectId))?.rootPath;
  }

  /** The Project's grant as stored, without the session's off list; null once the Project is gone. */
  async projectGrantFor(ticket: AgentTicket): Promise<ConnectorGrant | undefined> {
    if (!(await this.projects.project(ticket.projectId))) return undefined;
    return (await this.service.store.projectGrants())[ticket.projectId];
  }

  /**
   * The session's grant now: its Project's, less what the session turned off. Read on every call,
   * so an edit applies to the next tool call; an archived Project or Bot has none.
   */
  async grantFor(ticket: AgentTicket): Promise<ConnectorGrant | undefined> {
    const grant = await this.projectGrantFor(ticket);
    return sessionGrant(grant, await this.sessionOff(ticket));
  }

  /** The tools this session may use beyond its Project's grant, kept by the daemon. */
  async sessionAllows(ticket: AgentTicket): Promise<ReadonlySet<string>> {
    const allows = await this.service.store.sessionAllows();
    return new Set(
      this.projects.allowOwners(ticket.agentId).flatMap((owner) => allows[owner] ?? []),
    );
  }

  /** What the session leaves off (its label, its Chat's list), read on every call. */
  sessionOff(ticket: AgentTicket): Promise<Set<string>> {
    return this.projects.offList(ticket.agentId);
  }

  /**
   * Whether a call that sends something may go ahead. `ask` raises a permission request in
   * the agent's timeline (and on its channel) and waits; an answer is remembered for ten
   * minutes so a retry after the agent's own tool timeout does not ask twice.
   */
  async decideSends(params: {
    ticket: AgentTicket;
    grant: ConnectorGrant;
    tools: ConnectorTargetTool[];
    args: unknown;
    serverLabel: string;
    /** The MCP server's name for a server target; Composio sends name their app. */
    serverName?: string;
  }): Promise<SendDecision> {
    const sends = params.tools.filter((tool) => tool.kind === "send");
    if (sends.length === 0) return { allowed: true };
    if (connectorSendPolicyOf(params.grant.sends) === "allow")
      return this.countSends(params.ticket.projectId, params.grant, sends.length);
    if (!this.permissionHost) {
      return {
        allowed: false,
        message: "This Host cannot ask for approval right now; the call was not performed.",
      };
    }
    const names = sends.map((tool) => tool.name);
    const key = createHash("sha256")
      .update(JSON.stringify([params.ticket.agentId, names, params.args ?? null]))
      .digest("hex");
    const host = this.permissionHost;
    const catalog = await this.service.catalogApps();
    const outcome = await this.approvals.decide(key, (id) =>
      host.requestDaemonPermission(params.ticket.agentId, sendRequest(id, sends, params, catalog)),
    );
    if (outcome.kind === "allowed") return { allowed: true, waited: true, approvalKey: key };
    if (outcome.kind === "taken") {
      return {
        allowed: false,
        message: `An identical call to ${names.join(", ")} was approved and sent; this one was not, so nothing was sent twice.`,
      };
    }
    return {
      allowed: false,
      message: `The person declined ${names.join(", ")}${outcome.message ? `: ${outcome.message}` : "."} The call was not performed.`,
    };
  }

  /** Keeps an Allow whose call was not sent because the agent hung up; its retry uses it. */
  keepApproval(key: string): void {
    this.approvals.keep(key);
  }

  private loadSendCounts(): Promise<void> {
    this.sendCountsLoaded ??= this.service.store
      .sendCounts()
      .then((saved) => this.mergeSendCounts(saved))
      .catch(() => undefined);
    return this.sendCountsLoaded;
  }

  /** Counts saved before this boot; a count already made since boot is newer. */
  private mergeSendCounts(saved: SendCounts): void {
    for (const [projectId, entry] of Object.entries(saved)) {
      if (!this.sendCounts.has(projectId)) this.sendCounts.set(projectId, entry);
    }
  }

  /** Counts the sends before they run, so two calls at once cannot both take the last one. */
  private async countSends(
    projectId: string,
    grant: ConnectorGrant,
    count: number,
  ): Promise<SendDecision> {
    await this.loadSendCounts();
    const limit = Math.min(
      grant.dailySendLimit ?? DEFAULT_CONNECTOR_DAILY_SEND_LIMIT,
      MAX_CONNECTOR_DAILY_SEND_LIMIT,
    );
    const day = localDay(this.now());
    const current = this.sendCounts.get(projectId);
    const used = current?.day === day ? current.count : 0;
    if (used + count > limit) {
      return {
        allowed: false,
        message: `This Project reached its limit of ${limit} sends today; the call was not performed. The person can raise the limit in its Connectors.`,
      };
    }
    this.sendCounts.set(projectId, { day, count: used + count });
    void this.service.store
      .saveSendCounts(Object.fromEntries(this.sendCounts))
      .catch(() => undefined);
    return { allowed: true };
  }
}

/**
 * The send request: the plain title, description and input every client shows, and the send card
 * (`CONNECTOR_CARD_METADATA`) that shows the app's logo and the arguments as labelled lines.
 */
function sendRequest(
  id: string,
  sends: ConnectorTargetTool[],
  params: { ticket: AgentTicket; args: unknown; serverLabel: string; serverName?: string },
  catalog: CatalogApps | null,
): Omit<AgentPermissionRequest, "provider"> {
  const input = sendInput(sends, params.args);
  // "notes: Send note" reads like "Gmail: Send email"; the label is for servers without a name.
  const title = sendTitle(sends, params.serverName ?? params.serverLabel, catalog?.names);
  const toolkit = sends[0]!.toolkit;
  const logo = toolkit ? catalog?.logos.get(toolkit) : undefined;
  const card: ConnectorCard = {
    action: "send",
    app: toolkit ?? `mcp:${params.serverName ?? params.serverLabel}`,
    appName: toolkit
      ? (catalog?.names.get(toolkit) ?? connectorAppTitle(toolkit))
      : (params.serverName ?? params.serverLabel),
    ...(logo ? { logo } : {}),
    projectId: params.ticket.projectId,
    title,
    fields: sendCardFields(input),
  };
  return {
    id,
    name: sends.map((tool) => tool.name).join(", "),
    kind: "tool",
    title,
    description: "This agent wants to send something on your behalf. Check who receives it.",
    input,
    metadata: { [CONNECTOR_CARD_METADATA]: card },
  };
}

/** "Gmail: Send email", or the tools in a list when one call sends through several. */
function sendTitle(
  sends: ConnectorTargetTool[],
  serverLabel: string,
  appNames: ReadonlyMap<string, string> | undefined,
): string {
  const parts = sends.map((tool) => {
    const app = tool.toolkit
      ? (appNames?.get(tool.toolkit) ?? connectorAppTitle(tool.toolkit))
      : serverLabel;
    return `${app}: ${readableAction(tool.name, tool.toolkit)}`;
  });
  return parts.join(", ");
}

function readableAction(name: string, toolkit: string | null): string {
  const words = actionWords(name, toolkit ?? undefined).map((word) => word.toLowerCase());
  const sentence = words.join(" ") || name;
  return sentence[0]!.toUpperCase() + sentence.slice(1);
}

/**
 * What the person reads before approving: each sending tool's own arguments (to, subject,
 * body), not Composio's executor wrapper around them. Several sends are listed one by one, so
 * two sends through the same tool both show.
 */
function sendInput(sends: ConnectorTargetTool[], args: unknown): Record<string, unknown> {
  const wanted = new Set(sends.map((tool) => tool.name));
  const entries = isRecord(args) && Array.isArray(args.tools) ? args.tools : null;
  if (!entries) return isRecord(args) ? args : {};
  const picked: { tool: string; arguments: unknown }[] = [];
  for (const entry of entries) {
    const slug = entryToolSlug(entry);
    if (slug !== null && isRecord(entry) && wanted.has(slug)) {
      picked.push({ tool: slug, arguments: entry.arguments ?? null });
    }
  }
  if (picked.length === 1 && isRecord(picked[0]!.arguments)) return picked[0]!.arguments;
  return { sends: picked };
}

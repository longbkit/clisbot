import { z } from "zod";
import { AgentToolsGrantSchema } from "./agent-tools.js";

/**
 * Connectors (docs/features/connectors/README.md): third-party apps agents can act in,
 * connected through Composio, plus MCP servers the user runs. Settings and secrets live on
 * one Host; a Project names what its sessions may use by reference.
 */

/** Composio's toolkit slug, lower case (`gmail`, `googlecalendar`, `bland_ai`, `_1password`). */
export const CONNECTOR_APP_SLUG_PATTERN = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
/** An MCP server name doubles as the tool prefix, so it stays short and plain. */
export const CONNECTOR_MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
/** Header and environment names, never values. */
export const CONNECTOR_SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** A readable app name from its slug, for an app the catalog has not named: `_1password` → "1password". */
export function connectorAppTitle(slug: string): string {
  return slug
    .replace(/^_+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const ConnectorCatalogItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** An https image URL from Composio, when it has one. */
  logo: z.string().optional(),
  categories: z.array(z.string()).optional(),
  toolsCount: z.number().optional(),
  /** Public tools that need no sign-in. */
  noAuth: z.boolean().optional(),
});
export type ConnectorCatalogItem = z.infer<typeof ConnectorCatalogItemSchema>;

/** Composio's statuses, kept as strings so a new one never breaks an old client. */
export const ConnectorAccountSchema = z.object({
  id: z.string(),
  alias: z.string().optional(),
  /** `ACTIVE`, `INITIATED`, `FAILED`, `EXPIRED`, … */
  status: z.string(),
  updatedAt: z.string().optional(),
});
export type ConnectorAccount = z.infer<typeof ConnectorAccountSchema>;

export const ConnectorAppStateSchema = z.object({
  slug: z.string(),
  accounts: z.array(ConnectorAccountSchema),
});
export type ConnectorAppState = z.infer<typeof ConnectorAppStateSchema>;

/*
 * Values a later daemon may add (transports, tool kinds, access levels, send policies) travel as
 * plain strings, so an older client still parses the message. The daemon accepts only the values
 * it knows (`connector-grant-rules.ts`, `connector-store.ts`); clients treat an unknown one as the
 * safest known value.
 */

export const CONNECTOR_MCP_TRANSPORTS = ["http", "stdio"] as const;
export type ConnectorMcpTransport = (typeof CONNECTOR_MCP_TRANSPORTS)[number];
export const ConnectorMcpTransportSchema = z.string();

/** One MCP server as the app sees it: secret names, never secret values. */
export const ConnectorMcpServerSchema = z.object({
  name: z.string(),
  transport: ConnectorMcpTransportSchema,
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  headerKeys: z.array(z.string()).optional(),
  envKeys: z.array(z.string()).optional(),
  /** `false` turns the server off for every agent without forgetting it; absent means on. */
  enabled: z.boolean().optional(),
});
export type ConnectorMcpServer = z.infer<typeof ConnectorMcpServerSchema>;

export const ConnectorSettingsSchema = z.object({
  composio: z.object({
    configured: z.boolean(),
    /** `ak_…wxyz`, enough to tell two keys apart. */
    keyHint: z.string().optional(),
  }),
  mcpServers: z.array(ConnectorMcpServerSchema),
});
export type ConnectorSettings = z.infer<typeof ConnectorSettingsSchema>;

/** How a tool touches the outside world; `send` covers anything someone else receives. */
export const CONNECTOR_TOOL_KINDS = ["read", "write", "send"] as const;
export type ConnectorToolKind = (typeof CONNECTOR_TOOL_KINDS)[number];
export const ConnectorToolKindSchema = z.string();

export const ConnectorToolSchema = z.object({
  /** The name agents call, e.g. `GMAIL_SEND_EMAIL`. */
  name: z.string(),
  /** A readable name, e.g. "Send Email", when the app or server gives one. */
  title: z.string().optional(),
  description: z.string().optional(),
  kind: ConnectorToolKindSchema,
});
export type ConnectorTool = z.infer<typeof ConnectorToolSchema>;

/** `all`, or the exact tool names a Project may call. */
export const ConnectorToolSelectionSchema = z.union([z.literal("all"), z.array(z.string())]);
export type ConnectorToolSelection = z.infer<typeof ConnectorToolSelectionSchema>;

export const CONNECTOR_ACCESS_LEVELS = ["read", "write"] as const;
export type ConnectorAccess = (typeof CONNECTOR_ACCESS_LEVELS)[number];
export const ConnectorAccessSchema = z.string();

export const CONNECTOR_SEND_POLICIES = ["ask", "allow"] as const;
export type ConnectorSendPolicy = (typeof CONNECTOR_SEND_POLICIES)[number];
export const ConnectorSendPolicySchema = z.string();

/** A stored or received access level, unknown ones read as the narrower `read`. */
export function connectorAccessOf(value: string | undefined): ConnectorAccess {
  return value === "write" ? "write" : "read";
}

/** A send policy, unknown ones read as `ask`. */
export function connectorSendPolicyOf(value: string | undefined): ConnectorSendPolicy {
  return value === "allow" ? "allow" : "ask";
}

/** A tool kind, unknown ones read as `send`, the kind that asks first. */
export function connectorToolKindOf(value: string): ConnectorToolKind {
  return (CONNECTOR_TOOL_KINDS as readonly string[]).includes(value)
    ? (value as ConnectorToolKind)
    : "send";
}

export const DEFAULT_CONNECTOR_DAILY_SEND_LIMIT = 25;
export const MAX_CONNECTOR_DAILY_SEND_LIMIT = 1000;

/**
 * What the agent sessions of one Project may use. A Bot is a Project, so a Bot's Connectors are
 * its Project's grant. References only; an app or server the grant does not name is refused, and
 * an absent grant gives the Project no Connectors at all.
 */
export const ConnectorGrantSchema = z.object({
  apps: z
    .record(
      z.string(),
      z.object({
        tools: ConnectorToolSelectionSchema,
        access: ConnectorAccessSchema,
        /** `all`, or the connected account ids the Project may act as; absent means all. */
        accounts: z.union([z.literal("all"), z.array(z.string())]).optional(),
        /** `false` pauses this app for the Project and keeps its settings; absent means on. */
        enabled: z.boolean().optional(),
      }),
    )
    .optional(),
  mcpServers: z
    .record(
      z.string(),
      z.object({ tools: ConnectorToolSelectionSchema, enabled: z.boolean().optional() }),
    )
    .optional(),
  /**
   * `false` turns off the agent's own app integrations for this Project (Codex's ChatGPT apps), so
   * apps are reached only through Connectors; absent means on.
   */
  builtInApps: z.boolean().optional(),
  /** Tools that send something to someone: ask each time (default) or allow up to the limit. */
  sends: ConnectorSendPolicySchema.optional(),
  /** At most `MAX_CONNECTOR_DAILY_SEND_LIMIT`; the daemon enforces it, the wire does not. */
  dailySendLimit: z.number().optional(),
  /** The Clisbot tools (`agent-tools.ts`); unset follows the Host's "Inject Clisbot tools". */
  agentTools: AgentToolsGrantSchema.optional(),
  /** The browser tools; unset follows the Host's "Browser tools". */
  browserTools: z.boolean().optional(),
});
export type ConnectorGrant = z.infer<typeof ConnectorGrantSchema>;

/** The apps of a grant that are on; a paused one keeps its settings but is not offered. */
export function connectorEnabledApps(grant: ConnectorGrant | undefined): string[] {
  return Object.entries(grant?.apps ?? {})
    .filter(([, app]) => app.enabled !== false)
    .map(([slug]) => slug);
}

/** The MCP servers of a grant that are on. */
export function connectorEnabledServers(grant: ConnectorGrant | undefined): string[] {
  return Object.entries(grant?.mcpServers ?? {})
    .filter(([, server]) => server.enabled !== false)
    .map(([name]) => name);
}

export const ProjectConnectorGrantSchema = z.object({
  projectId: z.string(),
  grant: ConnectorGrantSchema,
});
export type ProjectConnectorGrant = z.infer<typeof ProjectConnectorGrantSchema>;

/**
 * Agent label naming what one session leaves off, comma separated: `gmail` for an app, `mcp:notes`
 * for an MCP server, `gmail/GMAIL_SEND_EMAIL` or `mcp:notes/send_note` for one of their tools,
 * `tools:<group>` and `tool:<name>` for Clisbot tools, `skill:<name>` for a skill. A label can
 * only take away from the Project's grant, so a client writing it cannot widen what the session
 * may use.
 */
export const CONNECTORS_OFF_LABEL = "clisbot.connectors-off";

export function readConnectorsOff(labels: Record<string, unknown> | null | undefined): Set<string> {
  const value = labels?.[CONNECTORS_OFF_LABEL];
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function formatConnectorsOff(off: Iterable<string>): string {
  return [...new Set(off)].sort().join(",");
}

/** The key a session's off list uses for an app or an MCP server. */
export function connectorOffKey(target: { app: string } | { mcpServer: string }): string {
  return "app" in target ? target.app : `mcp:${target.mcpServer}`;
}

/** The key a session's off list uses for one tool of an app or an MCP server. */
export function connectorToolOffKey(
  target: { app: string } | { mcpServer: string },
  tool: string,
): string {
  return `${connectorOffKey(target)}/${tool}`;
}

const SKILL_OFF_PREFIX = "skill:";

/** The key a session's off list uses for one skill. */
export function skillOffKey(skill: string): string {
  return `${SKILL_OFF_PREFIX}${skill}`;
}

/** The skills an off list names. */
export function skillsInOffList(off: Iterable<string>): string[] {
  return [...off]
    .filter((key) => key.startsWith(SKILL_OFF_PREFIX))
    .map((key) => key.slice(SKILL_OFF_PREFIX.length))
    .sort();
}

/** The skills a session's labels turn off. */
export function readSkillsOff(labels: Record<string, unknown> | null | undefined): string[] {
  return skillsInOffList(readConnectorsOff(labels));
}

/**
 * Metadata key on a daemon permission request that is a Connector card: the relay holds a tool
 * call until the app is connected (`connect`) or allowed for the Project (`grant`). Clients that
 * know it draw a dedicated card; others show the request's title, description and actions.
 */
export const CONNECTOR_CARD_METADATA = "clisbotConnector";

/** One line of what a send card shows: who receives it, what it says. */
export const ConnectorCardFieldSchema = z.object({ label: z.string(), value: z.string() });

/**
 * A Connector card on a daemon permission request. `send` (added with Connectors' send cards) asks
 * before a send and shows `fields`; a client that does not know it shows the plain request.
 */
export const ConnectorCardSchema = z.object({
  action: z.enum(["connect", "grant", "send"]),
  app: z.string(),
  appName: z.string(),
  logo: z.string().optional(),
  projectId: z.string(),
  title: z.string().optional(),
  fields: z.array(ConnectorCardFieldSchema).optional(),
});
export type ConnectorCard = z.infer<typeof ConnectorCardSchema>;

/** The `errorCode` values a `connectors.*` reply carries; the wire keeps the field a string. */
export const CONNECTOR_ERROR_CODES = [
  "connectors_disabled",
  "invalid_request",
  "composio_not_configured",
  "composio_rejected",
  "access_denied",
  "not_found",
  "conflict",
  "upstream_unavailable",
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

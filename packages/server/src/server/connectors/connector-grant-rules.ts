import {
  CONNECTOR_ACCESS_LEVELS,
  CONNECTOR_APP_SLUG_PATTERN,
  CONNECTOR_MCP_SERVER_NAME_PATTERN,
  CONNECTOR_SEND_POLICIES,
  MAX_CONNECTOR_DAILY_SEND_LIMIT,
  type ConnectorGrant,
  type ConnectorToolSelection,
} from "@clisbot/protocol/connectors/types";
import { agentToolGroupOf } from "@clisbot/protocol/connectors/agent-tools";

/**
 * What the daemon stores for a Project's grant (docs/features/connectors/README.md). The wire
 * carries levels and policies as plain strings so a newer daemon never breaks an older client;
 * this check keeps the store to the values this daemon knows, so a grant it cannot read is
 * refused when it is written instead of being read loosely later.
 */

const MAX_GRANTED = 100;
const MAX_TOOLS = 500;
const MAX_ACCOUNTS = 20;

class ConnectorGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorGrantError";
  }
}

function checkTools(tools: ConnectorToolSelection, where: string): void {
  if (tools === "all") return;
  if (tools.length > MAX_TOOLS || tools.some((tool) => !tool || tool.length > 200)) {
    throw new ConnectorGrantError(`${where}: pick at most ${MAX_TOOLS} tools, each by name.`);
  }
}

function checkApp(slug: string, app: NonNullable<ConnectorGrant["apps"]>[string]): void {
  if (!CONNECTOR_APP_SLUG_PATTERN.test(slug)) {
    throw new ConnectorGrantError(`"${slug}" is not an app.`);
  }
  if (!(CONNECTOR_ACCESS_LEVELS as readonly string[]).includes(app.access)) {
    throw new ConnectorGrantError(`${slug}: access must be read or write.`);
  }
  checkTools(app.tools, slug);
  if (Array.isArray(app.accounts) && app.accounts.length > MAX_ACCOUNTS) {
    throw new ConnectorGrantError(`${slug}: name at most ${MAX_ACCOUNTS} accounts.`);
  }
}

/** Disabled agent tools are names this daemon offers; a typo would silently disable nothing. */
function checkAgentTools(grant: ConnectorGrant): void {
  const disabled = grant.agentTools?.disabledTools ?? [];
  const unknown = disabled.find((tool) => agentToolGroupOf(tool) === undefined);
  if (unknown !== undefined) {
    throw new ConnectorGrantError(`"${unknown}" is not a Clisbot or browser tool.`);
  }
}

/** Throws when the grant holds a value this daemon does not know or a size past its limits. */
export function checkConnectorGrant(grant: ConnectorGrant): void {
  checkAgentTools(grant);
  const apps = Object.entries(grant.apps ?? {});
  const servers = Object.entries(grant.mcpServers ?? {});
  if (apps.length + servers.length > MAX_GRANTED) {
    throw new ConnectorGrantError(`A Project holds at most ${MAX_GRANTED} Connectors.`);
  }
  for (const [slug, app] of apps) checkApp(slug, app);
  for (const [name, server] of servers) {
    if (!CONNECTOR_MCP_SERVER_NAME_PATTERN.test(name)) {
      throw new ConnectorGrantError(`"${name}" is not an MCP server name.`);
    }
    checkTools(server.tools, name);
  }
  if (
    grant.sends !== undefined &&
    !(CONNECTOR_SEND_POLICIES as readonly string[]).includes(grant.sends)
  ) {
    throw new ConnectorGrantError("Sends must be ask or allow.");
  }
  const limit = grant.dailySendLimit;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONNECTOR_DAILY_SEND_LIMIT)
  ) {
    throw new ConnectorGrantError(
      `The daily send limit is a whole number from 1 to ${MAX_CONNECTOR_DAILY_SEND_LIMIT}.`,
    );
  }
}

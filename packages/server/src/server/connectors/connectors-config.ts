/**
 * `daemon.connectors` resolved at startup (docs/features/connectors/README.md, "Feature flag").
 * On by default: nothing leaves the Host until someone saves a Composio key or adds an MCP
 * server. Off: no RPC, no relay route, no sidebar row; the daemon behaves as upstream.
 */
export interface ConnectorsConfig {
  enabled: boolean;
  /** Composio's REST base; overridden in tests to point at a local fake. */
  composioApiUrl: string;
}

export interface PersistedConnectorsConfig {
  enabled?: boolean;
}

export const CONNECTORS_ENABLED_ENV = "CLISBOT_CONNECTORS_ENABLED";
export const COMPOSIO_API_URL_ENV = "CLISBOT_COMPOSIO_API_URL";
export const DEFAULT_COMPOSIO_API_URL = "https://backend.composio.dev/api/v3.1";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function resolveConnectorsConfig(input: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConnectorsConfig | undefined;
}): ConnectorsConfig {
  return {
    // COMPAT(clisbot-connectors-default): upstream Clisbot has no Connectors; the fusion runs
    // them unless `daemon.connectors.enabled: false` or `CLISBOT_CONNECTORS_ENABLED=0`.
    enabled: parseBooleanEnv(input.env[CONNECTORS_ENABLED_ENV]) ?? input.persisted?.enabled ?? true,
    composioApiUrl: (input.env[COMPOSIO_API_URL_ENV]?.trim() || DEFAULT_COMPOSIO_API_URL).replace(
      /\/+$/,
      "",
    ),
  };
}

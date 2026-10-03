// Clisbot Hub owns these HTTP namespaces. The daemon keeps /ws, /api/health,
// /api/status, /api/files, /api/terminal-activity and its agent MCP endpoints.
export const HUB_PROXY_CLIENT_IP_HEADER = "x-clisbot-proxy-client-ip";

const HUB_PREFIXES = [
  "/api/auth",
  "/api/management",
  "/api/v1",
  "/api/daemons",
  "/api/billing",
  "/api/integrations",
  "/api/open",
  "/mcp/channel",
  "/agent-executions",
];
const HUB_PATHS = new Set(["/health", "/webhook", "/api/openapi.json"]);

export function isHubHttpPath(path: string): boolean {
  return (
    HUB_PATHS.has(path) ||
    HUB_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

export function isHubWebSocketPath(path: string): boolean {
  return path === "/api/daemons/socket" || path === "/api/auth/clisbot/device/socket";
}

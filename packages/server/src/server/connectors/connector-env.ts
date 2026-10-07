import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The environment of a local (stdio) MCP server (docs/features/connectors/README.md, "Runtime").
 * It starts from the minimal set an MCP client passes (PATH, HOME, USER, SHELL, TERM; the SDK's
 * `getDefaultEnvironment`), plus locale, temp dir and proxy settings, plus the server's own
 * variables. Nothing else of the daemon's reaches it: no provider API keys, no tokens. A server
 * that needs a key gets it from its own variables.
 */

const PASSED_THROUGH = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/**
 * Variables Clisbot sets on its own processes. A server's variables never use them: one could
 * point Clisbot's tools elsewhere or read another tool's token.
 */
export function isReservedEnvName(name: string): boolean {
  return name.toUpperCase().startsWith("CLISBOT_") || name === "ELECTRON_RUN_AS_NODE";
}

export function stdioServerEnv(own: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const name of PASSED_THROUGH) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(own)) {
    if (!isReservedEnvName(name)) env[name] = value;
  }
  return env;
}

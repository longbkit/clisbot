import { isHubHttpPath } from "@clisbot/protocol/hub-http";

export function publicAppOrigin(port: number, env: NodeJS.ProcessEnv = process.env): string {
  return env["CLISBOT_HUB_APP_URL"]?.trim() || `http://localhost:${port}`;
}

// Keep the inherited dashboard code available for upstream reconciliation.
// Clisbot's supported UI is the shared app; the Hub serves its backend only.
export function isHubRequestEnabled(
  request: Request,
  dashboard = process.env["CLISBOT_HUB_WEB_UI_ENABLED"],
): boolean {
  const url = new URL(request.url);
  const accountEntry =
    url.pathname === "/" &&
    url.searchParams.get("client_id") === "clisbot-client" &&
    url.searchParams.get("response_type") === "code";
  const cliEntry = url.pathname === "/cli-login" && Boolean(url.searchParams.get("code"));
  // Account UI and its authenticated server functions are needed by public/native OAuth
  // even with no local web. Domain authorization remains in those existing functions.
  return (
    dashboard === "true" ||
    isHubHttpPath(url.pathname) ||
    accountEntry ||
    cliEntry ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_serverFn/")
  );
}

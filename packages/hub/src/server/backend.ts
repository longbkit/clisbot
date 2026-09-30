import { isHubHttpPath } from "@clisbot/protocol/hub-http";

export function publicAppOrigin(port: number, env: NodeJS.ProcessEnv = process.env): string {
  return (
    env["CLISBOT_HUB_APP_URL"]?.trim() ||
    (env["CLISBOT_HUB_WEB_UI_ENABLED"] === "true"
      ? `http://localhost:${port}`
      : "http://localhost:6868")
  );
}

// Keep the inherited dashboard code available for upstream reconciliation.
// Clisbot's supported UI is the shared app; the Hub serves its backend only.
export function isHubRequestEnabled(
  request: Request,
  dashboard = process.env["CLISBOT_HUB_WEB_UI_ENABLED"],
): boolean {
  return dashboard === "true" || isHubHttpPath(new URL(request.url).pathname);
}

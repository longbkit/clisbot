import { expect, test } from "vitest";
import { isHubRequestEnabled, publicAppOrigin } from "./backend.js";

test("browser URLs target the shared UI while legacy dashboard tests keep their own origin", () => {
  expect(publicAppOrigin(6870, {})).toBe("http://localhost:6868");
  expect(publicAppOrigin(7123, { CLISBOT_HUB_WEB_UI_ENABLED: "true" })).toBe(
    "http://localhost:7123",
  );
  expect(publicAppOrigin(7123, { CLISBOT_HUB_APP_URL: "https://work.example.com" })).toBe(
    "https://work.example.com",
  );
});

test("backend mode retains auth, management, provider callbacks and tools", () => {
  for (const path of [
    "/health",
    "/api/auth/sign-in/email",
    "/api/management/v1/account",
    "/api/daemons/socket",
    "/api/integrations/slack/events",
    "/mcp/channel/token",
    "/agent-executions/run/mcp",
    "/webhook",
  ]) {
    expect(isHubRequestEnabled(new Request(`http://localhost${path}`), "false")).toBe(true);
  }
});

test("backend mode never serves the inherited dashboard or its server functions", () => {
  for (const path of [
    "/",
    "/o/example/settings",
    "/cli-login",
    "/api/reference",
    "/assets/index.js",
    "/_serverFn/example",
  ]) {
    const request = new Request(`http://localhost${path}`);
    expect(isHubRequestEnabled(request, "false")).toBe(false);
    expect(isHubRequestEnabled(request, "true")).toBe(true);
  }
});

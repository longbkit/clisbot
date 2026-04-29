import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Slack manifest template", () => {
  test("includes prompt-context lookup scopes", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "templates/slack/default/app-manifest.json"), "utf8"),
    ) as { oauth_config?: { scopes?: { bot?: string[] } } };
    const botScopes = manifest.oauth_config?.scopes?.bot ?? [];

    expect(botScopes).toContain("users:read");
    expect(botScopes).toContain("channels:read");
    expect(botScopes).toContain("groups:read");
    expect(botScopes).toContain("im:read");
    expect(botScopes).toContain("mpim:read");
  });
});

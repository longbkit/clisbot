import { describe, expect, it } from "vitest";
import { isComposioUrl } from "./composio-client.js";

describe("isComposioUrl", () => {
  it("trusts Composio's own https hosts and the configured API host over its own protocol", () => {
    const api = "https://backend.composio.dev/api/v3";
    expect(isComposioUrl("https://connect.composio.dev/link/x", api)).toBe(true);
    expect(isComposioUrl("http://backend.composio.dev/mcp", api)).toBe(false);
    expect(isComposioUrl("https://composio.dev.evil.com/x", api)).toBe(false);
    expect(isComposioUrl("http://127.0.0.1:7801/mcp", "http://127.0.0.1:7801")).toBe(true);
    expect(isComposioUrl("not a url", api)).toBe(false);
  });
});

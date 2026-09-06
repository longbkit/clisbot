import { describe, expect, it } from "vitest";
import { hubConnectionResult } from "./connection-result";

describe("provider callback results", () => {
  it("explains completion and cancellation for every supported provider", () => {
    for (const app of ["github", "slack", "discord", "linear"]) {
      expect(hubConnectionResult({ app, result: `${app}_connected` })).toMatchObject({
        variant: "success",
      });
      expect(hubConnectionResult({ app, result: `${app}_cancelled` })).toMatchObject({
        variant: "info",
      });
    }
  });

  it("provides recovery actions for rejected, expired, and incomplete setup", () => {
    for (const result of [
      "github_approval_required",
      "slack_bot_failed",
      "provider_not_configured",
      "connection_invalid",
      "connection_conflict",
    ]) {
      expect(hubConnectionResult({ result })?.description.length).toBeGreaterThan(0);
    }
    expect(hubConnectionResult({ result: "connection_invalid" })?.description).toContain(
      "Connect account",
    );
  });

  it("ignores malformed, unknown, duplicate, and contradictory URL parameters", () => {
    for (const input of [
      {},
      { result: "arbitrary message" },
      { result: "__proto__" },
      { result: "constructor" },
      { result: ["github_connected", "github_cancelled"] },
      { app: ["github"], result: "github_connected" },
      { app: "other", result: "github_connected" },
      { app: "slack", result: "github_connected" },
    ]) {
      expect(hubConnectionResult(input)).toBe(null);
    }
  });
});

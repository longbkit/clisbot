import { describe, expect, it } from "vitest";
import { redactAccountConfig, restoreAccountConfigSecrets } from "./account-secrets.js";

describe("account config secrets", () => {
  it("hides the keys a channel schema marks secret", () => {
    const config = {
      appId: "cli_1",
      appSecret: "s3cret",
      verificationToken: "v",
      encryptKey: "k",
      domain: "lark",
    };
    expect(redactAccountConfig("feishu", config)).toEqual({ appId: "cli_1", domain: "lark" });
    expect(redactAccountConfig("zalo", { webhookSecret: "12345678", proxy: "p" })).toEqual({
      proxy: "p",
    });
  });

  it("hides upstream credentials on schema-less channels by name, at any depth", () => {
    const config = { botToken: "xoxb", richMessages: true, nested: { signingSecret: "x", a: 1 } };
    expect(redactAccountConfig("slack", config)).toEqual({ richMessages: true, nested: { a: 1 } });
  });

  it("puts back the stored credentials a save leaves out, and keeps one it states", () => {
    const stored = { appSecret: "old", appId: "cli_1", nested: { apiKey: "k" } };
    expect(restoreAccountConfigSecrets("feishu", stored, { appId: "cli_2", nested: {} })).toEqual({
      appId: "cli_2",
      appSecret: "old",
      nested: { apiKey: "k" },
    });
    expect(restoreAccountConfigSecrets("feishu", stored, { appSecret: "new" })).toEqual({
      appSecret: "new",
    });
  });
});

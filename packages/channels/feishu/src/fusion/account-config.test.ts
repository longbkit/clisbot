import { describe, expect, it } from "vitest";
import { mergeAccountCarrier, resolveFeishuDriveAccount } from "./account-config.js";
import type { OpenClawConfig } from "./runtime-api.js";

const authored = {
  channels: {
    feishu: {
      enabled: true,
      accounts: {
        main: { appId: "cli_authored", appSecret: "authored-secret" },
      },
    },
  },
} as unknown as OpenClawConfig;

describe("mergeAccountCarrier", () => {
  it("lets a Hub connection credential win over authored config", () => {
    const merged = mergeAccountCarrier(authored, "main", {
      appId: "cli_from_connection",
      appSecret: "connection-secret",
      encryptKey: "connection-encrypt",
      connectionMode: "webhook",
    });
    const feishu = merged.channels?.feishu as {
      accounts: Record<string, Record<string, string>>;
    };
    const entry = feishu.accounts.main;
    expect(entry).toMatchObject({
      appId: "cli_from_connection",
      appSecret: "connection-secret",
      encryptKey: "connection-encrypt",
      connectionMode: "webhook",
    });
  });

  it("ignores blank and unknown carrier fields", () => {
    const merged = mergeAccountCarrier(authored, "main", {
      appId: "   ",
      botToken: "not-a-feishu-field",
    });
    const feishu = merged.channels?.feishu as {
      accounts: Record<string, Record<string, string>>;
    };
    const entry = feishu.accounts.main as Record<string, string>;
    expect(entry.appId).toBe("cli_authored");
    expect(entry.botToken).toBeUndefined();
  });

  it("returns the config untouched when the carrier has nothing", () => {
    expect(mergeAccountCarrier(authored, "main", undefined)).toBe(authored);
    expect(mergeAccountCarrier(authored, "main", {})).toBe(authored);
  });
});

describe("resolveFeishuDriveAccount", () => {
  it("resolves the drive account from the two carriers", () => {
    const account = resolveFeishuDriveAccount({
      accountId: "main",
      account: { appSecret: "connection-secret" },
      cfg: authored as unknown as Record<string, unknown>,
    });
    expect(account.accountId).toBe("main");
    expect(account.appId).toBe("cli_authored");
    expect(account.appSecret).toBe("connection-secret");
    expect(account.configured).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { assertNoDuplicateTelegramTokens } from "./start-account.js";

function cfgWithAccounts(accounts: Record<string, { botToken?: string }>): Record<string, unknown> {
  return { channels: { telegram: { accounts } } };
}

describe("duplicate-token guard", () => {
  it("passes with distinct tokens or a single account", () => {
    assertNoDuplicateTelegramTokens(
      cfgWithAccounts({
        a: { botToken: "111:AAA" },
        b: { botToken: "222:BBB" },
      }),
      "a",
    );
    assertNoDuplicateTelegramTokens(cfgWithAccounts({ a: { botToken: "111:AAA" } }), "a");
    // Blank tokens are skipped, not collisions.
    assertNoDuplicateTelegramTokens(
      cfgWithAccounts({ a: { botToken: "111:AAA" }, b: { botToken: "  " } }),
      "a",
    );
  });

  it("throws when the active account's token matches another account's", () => {
    const cfg = cfgWithAccounts({ a: { botToken: "111:AAA" }, b: { botToken: "111:AAA" } });
    expect(() => assertNoDuplicateTelegramTokens(cfg, "a")).toThrow(/duplicate Telegram bot token/);
    expect(() => assertNoDuplicateTelegramTokens(cfg, "b")).toThrow(/duplicate Telegram bot token/);
  });

  it("throws when any two configured accounts share a token", () => {
    const cfg = cfgWithAccounts({
      a: { botToken: "111:AAA" },
      b: { botToken: "111:AAA" },
      c: { botToken: "333:CCC" },
    });
    expect(() => assertNoDuplicateTelegramTokens(cfg, "c")).toThrow(/duplicate Telegram bot token/);
  });
});

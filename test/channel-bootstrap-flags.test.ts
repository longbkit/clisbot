import { describe, expect, test } from "bun:test";
import { parseBootstrapFlags } from "../src/control/channel-bootstrap-flags.ts";

describe("parseBootstrapFlags", () => {
  test("maps --bot-type personal to the internal bootstrap mode", () => {
    const parsed = parseBootstrapFlags([
      "--cli",
      "codex",
      "--bot-type",
      "personal",
      "--telegram-bot-token",
      "TELEGRAM_BOT_TOKEN",
    ]);

    expect(parsed.cliTool).toBe("codex");
    expect(parsed.bootstrap).toBe("personal-assistant");
    expect(parsed.telegramAccounts[0]?.accountId).toBe("default");
    expect(parsed.telegramAccounts[0]?.botToken?.kind).toBe("env");
  });

  test("maps --bot-type team to the internal bootstrap mode", () => {
    const parsed = parseBootstrapFlags([
      "--bot-type",
      "team",
      "--telegram-bot-token",
      "TELEGRAM_BOT_TOKEN",
    ]);

    expect(parsed.bootstrap).toBe("team-assistant");
  });

  test("keeps --bootstrap as a compatibility alias", () => {
    const parsed = parseBootstrapFlags([
      "--bootstrap",
      "team-assistant",
      "--telegram-bot-token",
      "TELEGRAM_BOT_TOKEN",
    ]);

    expect(parsed.bootstrap).toBe("team-assistant");
  });

  test("rejects unknown bot types", () => {
    expect(() =>
      parseBootstrapFlags([
        "--bot-type",
        "ops",
        "--telegram-bot-token",
        "TELEGRAM_BOT_TOKEN",
      ]),
    ).toThrow("Invalid bot type: ops");
  });
});

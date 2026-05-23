import { afterEach, describe, expect, test } from "bun:test";
import {
  hasLiteralBootstrapCredentials,
  parseBootstrapFlags,
} from "../src/control/commands/channel-bootstrap-flags.ts";
import { applyBootstrapBotsToConfig } from "../src/config/channels/channel-bot-management.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

describe("parseBootstrapFlags", () => {
  const originalClisbotHome = process.env.CLISBOT_HOME;

  afterEach(() => {
    process.env.CLISBOT_HOME = originalClisbotHome;
  });

  test("maps --bot-type personal to the internal bootstrap mode", () => {
    const parsed = parseBootstrapFlags([
      "--cli",
      "gemini",
      "--bot-type",
      "personal",
      "--telegram-bot-token",
      "TELEGRAM_BOT_TOKEN",
    ]);

    expect(parsed.cliTool).toBe("gemini");
    expect(parsed.bootstrap).toBe("personal-assistant");
    expect(parsed.bots.telegram[0]?.botId).toBe("default");
    expect(parsed.bots.telegram[0]?.botToken?.kind).toBe("env");
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

  test("rejects legacy --bootstrap alias", () => {
    expect(() =>
      parseBootstrapFlags([
        "--bootstrap",
        "team-assistant",
        "--telegram-bot-token",
        "TELEGRAM_BOT_TOKEN",
      ]),
    ).toThrow("Unknown option for start/init: --bootstrap");
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

  test("does not emit literal token warnings for raw startup tokens", () => {
    const parsed = parseBootstrapFlags([
      "--slack-app-token",
      "xapp-literal",
      "--slack-bot-token",
      "xoxb-literal",
      "--telegram-account",
      "ops",
      "--telegram-bot-token",
      "123:literal",
      "--zalo-bot-account",
      "sales",
      "--zalo-bot-token",
      "zalo-literal",
    ]);

    expect(parsed.literalWarnings).toEqual([]);
    expect(parsed.bots.slack[0]?.appToken?.kind).toBe("mem");
    expect(parsed.bots.slack[0]?.botToken?.kind).toBe("mem");
    expect(parsed.bots.telegram[0]?.botToken?.kind).toBe("mem");
    expect(parsed.bots["zalo-bot"][0]?.botToken?.kind).toBe("mem");
  });

  test("detects literal bootstrap credentials independently of warning output", () => {
    const raw = parseBootstrapFlags([
      "--zalo-bot-token",
      "zalo-literal",
    ]);
    const envOnly = parseBootstrapFlags([
      "--zalo-bot-token",
      "ZALO_BOT_TOKEN",
    ]);

    expect(hasLiteralBootstrapCredentials(raw)).toBe(true);
    expect(hasLiteralBootstrapCredentials(envOnly)).toBe(false);
  });

  test("parses named zalo-bot accounts", () => {
    const parsed = parseBootstrapFlags([
      "--zalo-bot-account",
      "ops",
      "--zalo-bot-token",
      "${CUSTOM_ZALO_BOT_TOKEN}",
    ]);

    expect(parsed.bots["zalo-bot"]).toEqual([
      {
        botId: "ops",
        botToken: {
          kind: "env",
          placeholder: "${CUSTOM_ZALO_BOT_TOKEN}",
          envName: "CUSTOM_ZALO_BOT_TOKEN",
        },
      },
    ]);
    expect(parsed.sawChannels["zalo-bot"]).toBe(true);
  });

  test("parses zalo-personal QR bootstrap without token flags", () => {
    const parsed = parseBootstrapFlags([
      "--channel",
      "zalo-personal",
      "--bot",
      "work",
      "--qr-path",
      "./zalo-work.png",
    ]);

    expect(parsed.sawCredentialFlags).toBe(true);
    expect(parsed.sawChannels["zalo-personal"]).toBe(true);
    expect(parsed.bots["zalo-personal"]).toEqual([
      {
        botId: "work",
        qrPath: "./zalo-work.png",
      },
    ]);
  });

  test("applies zalo-personal QR bootstrap to tokenFile bot config", () => {
    process.env.CLISBOT_HOME = "~/.clisbot-dev";
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    const parsed = parseBootstrapFlags([
      "--channel",
      "zalo-personal",
      "--bot",
      "work",
      "--qr-path",
      "./zalo-work.png",
    ]);

    applyBootstrapBotsToConfig(config, parsed.bots, { firstRun: false });

    expect(config.bots.zaloPersonal.defaults.enabled).toBe(true);
    expect(config.bots.zaloPersonal.defaults.defaultBotId).toBe("work");
    expect(config.bots.zaloPersonal.work.credentialType).toBe("tokenFile");
    expect(config.bots.zaloPersonal.work.tokenFile).toBe(
      "~/.clisbot-dev/credentials/zalo-personal/work/auth-session",
    );
    expect(config.bots.zaloPersonal.work.botToken).toBeUndefined();
  });

  test("zalo-personal QR bootstrap preserves an existing custom tokenFile", () => {
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.bots.zaloPersonal.work = {
      enabled: true,
      credentialType: "tokenFile",
      tokenFile: "~/.clisbot/custom-zalo-work-session",
    } as any;
    const parsed = parseBootstrapFlags([
      "--channel",
      "zalo-personal",
      "--bot",
      "work",
      "--qr-path",
      "./zalo-work.png",
    ]);

    applyBootstrapBotsToConfig(config, parsed.bots, { firstRun: false });

    expect(config.bots.zaloPersonal.work.credentialType).toBe("tokenFile");
    expect(config.bots.zaloPersonal.work.tokenFile).toBe("~/.clisbot/custom-zalo-work-session");
  });

  test("rejects qr-path for non QR bootstrap channels", () => {
    expect(() =>
      parseBootstrapFlags([
        "--channel",
        "telegram",
        "--qr-path",
        "./telegram.png",
      ])
    ).toThrow("--channel telegram is not a QR bootstrap channel.");
  });
});

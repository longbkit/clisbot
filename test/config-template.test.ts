import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("renderDefaultConfigTemplate", () => {
  const originalClisbotHome = process.env.CLISBOT_HOME;

  afterEach(() => {
    process.env.CLISBOT_HOME = originalClisbotHome;
  });

  test("does not preseed sample slack or telegram routes", () => {
    const config = JSON.parse(renderDefaultConfigTemplate()) as {
      app: {
        auth: {
          defaultRole: string;
        };
      };
      agents: {
        defaults: {
          auth: {
            defaultRole: string;
          };
        };
      };
      channels: {
        slack: {
          enabled: boolean;
          appToken: string;
          botToken: string;
          streaming: string;
          verbose: string;
          channels: Record<string, unknown>;
          groups: Record<string, unknown>;
          accounts: {
            default: {
              appToken: string;
              botToken: string;
            };
          };
        };
        telegram: {
          enabled: boolean;
          botToken: string;
          streaming: string;
          verbose: string;
          groups: Record<string, unknown>;
          accounts: {
            default: {
              botToken: string;
            };
          };
        };
      };
    };

    expect(config.channels.slack.enabled).toBe(false);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.slack.streaming).toBe("off");
    expect(config.channels.telegram.streaming).toBe("off");
    expect(config.channels.slack.verbose).toBe("minimal");
    expect(config.channels.telegram.verbose).toBe("minimal");
    expect(config.channels.slack.appToken).toBe("");
    expect(config.channels.slack.botToken).toBe("");
    expect(config.channels.telegram.botToken).toBe("");
    expect(config.channels.slack.accounts.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.channels.slack.accounts.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.accounts.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
    expect(config.channels.slack.channels).toEqual({});
    expect(config.channels.slack.groups).toEqual({});
    expect(config.channels.telegram.groups).toEqual({});
    expect(config.app.auth.defaultRole).toBe("member");
    expect(config.agents.defaults.auth.defaultRole).toBe("member");
    expect(JSON.stringify(config)).not.toContain("privilegeCommands");
  });

  test("can enable only the available default channels", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: false,
      }),
    ) as {
      channels: {
        slack: {
          enabled: boolean;
          appToken: string;
          botToken: string;
          streaming: string;
          accounts: {
            default: {
              appToken: string;
              botToken: string;
            };
          };
        };
        telegram: {
          enabled: boolean;
          botToken: string;
          streaming: string;
          accounts: {
            default: {
              botToken: string;
            };
          };
        };
      };
    };

    expect(config.channels.slack.enabled).toBe(true);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.slack.streaming).toBe("off");
    expect(config.channels.telegram.streaming).toBe("off");
    expect(config.channels.slack.appToken).toBe("");
    expect(config.channels.slack.botToken).toBe("");
    expect(config.channels.telegram.botToken).toBe("");
    expect(config.channels.slack.accounts.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.channels.slack.accounts.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.accounts.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("preserves custom token env placeholders as literals", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
        slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
        slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
        telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      }),
    ) as {
      channels: {
        slack: {
          enabled: boolean;
          appToken: string;
          botToken: string;
          accounts: {
            default: {
              appToken: string;
              botToken: string;
            };
          };
        };
        telegram: {
          enabled: boolean;
          botToken: string;
          accounts: {
            default: {
              botToken: string;
            };
          };
        };
      };
    };

    expect(config.channels.slack.enabled).toBe(true);
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.slack.appToken).toBe("");
    expect(config.channels.slack.botToken).toBe("");
    expect(config.channels.telegram.botToken).toBe("");
    expect(config.channels.slack.accounts.default.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.channels.slack.accounts.default.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.accounts.default.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("normalizes bare custom env names into placeholders", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
        slackAppTokenRef: "CUSTOM_SLACK_APP_TOKEN",
        slackBotTokenRef: "CUSTOM_SLACK_BOT_TOKEN",
        telegramBotTokenRef: "CUSTOM_TELEGRAM_BOT_TOKEN",
      }),
    ) as {
      channels: {
        slack: {
          appToken: string;
          botToken: string;
          accounts: {
            default: {
              appToken: string;
              botToken: string;
            };
          };
        };
        telegram: {
          botToken: string;
          accounts: {
            default: {
              botToken: string;
            };
          };
        };
      };
    };

    expect(config.channels.slack.appToken).toBe("");
    expect(config.channels.slack.botToken).toBe("");
    expect(config.channels.telegram.botToken).toBe("");
    expect(config.channels.slack.accounts.default.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.channels.slack.accounts.default.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.accounts.default.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("renders default paths from CLISBOT_HOME", () => {
    process.env.CLISBOT_HOME = "~/.clisbot-dev";

    const template = JSON.parse(renderDefaultConfigTemplate());

    expect(template.tmux.socketPath).toBe("~/.clisbot-dev/state/clisbot.sock");
    expect(template.session.storePath).toBe("~/.clisbot-dev/state/sessions.json");
    expect(template.agents.defaults.workspace).toBe("~/.clisbot-dev/workspaces/{agentId}");
  });

  test("matches config/clisbot.json.template after normalizing dynamic fields", () => {
    delete process.env.CLISBOT_HOME;

    const generated = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: false,
      }),
    ) as Record<string, unknown>;
    const staticTemplate = JSON.parse(
      readFileSync(new URL("../config/clisbot.json.template", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    (generated.meta as { lastTouchedAt: string }).lastTouchedAt =
      "2026-04-15T00:00:00.000Z";
    (staticTemplate.meta as { lastTouchedAt: string }).lastTouchedAt =
      "2026-04-15T00:00:00.000Z";
    ((generated.control as { loop: { defaultTimezone: string } }).loop).defaultTimezone =
      "UTC";
    ((staticTemplate.control as { loop: { defaultTimezone: string } }).loop).defaultTimezone =
      "UTC";

    expect(staticTemplate).toEqual(generated);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readEditableConfig } from "../src/config/config-file.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("renderDefaultConfigTemplate", () => {
  const originalClisbotHome = process.env.CLISBOT_HOME;

  afterEach(() => {
    process.env.CLISBOT_HOME = originalClisbotHome;
  });

  test("renders the new app, bots, and agents shape without sample routes", () => {
    const config = JSON.parse(renderDefaultConfigTemplate()) as ReturnType<
      typeof clisbotConfigSchema.parse
    >;

    expect("channels" in config).toBe(false);
    expect(config.app.auth.defaultRole).toBe("member");
    expect(config.app.control.configReload.watch).toBe(true);
    expect(config.bots.defaults.allowBots).toBe(false);
    expect(config.bots.slack.defaults.enabled).toBe(false);
    expect(config.bots.slack.defaults.allowBots).toBe(false);
    expect(config.bots.telegram.defaults.enabled).toBe(false);
    expect(config.bots.telegram.defaults.allowBots).toBe(false);
    expect(config.bots.slack.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
    expect(config.bots.slack.default.directMessages).toEqual({});
    expect(config.bots.slack.default.groups).toEqual({});
    expect(config.bots.telegram.default.directMessages).toEqual({});
    expect(config.bots.telegram.default.groups).toEqual({});
    expect(config.agents.defaults.defaultAgentId).toBe("default");
    expect(config.agents.defaults.auth.defaultRole).toBe("member");
    expect(JSON.stringify(config)).not.toContain("privilegeCommands");
  });

  test("can enable only the selected providers and preserve explicit env placeholders", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: false,
        slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
        slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
      }),
    ) as ReturnType<typeof clisbotConfigSchema.parse>;

    expect(config.bots.slack.defaults.enabled).toBe(true);
    expect(config.bots.slack.default.enabled).toBe(true);
    expect(config.bots.telegram.defaults.enabled).toBe(false);
    expect(config.bots.telegram.default.enabled).toBe(false);
    expect(config.bots.slack.default.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("normalizes bare env names into placeholders", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
        slackAppTokenRef: "CUSTOM_SLACK_APP_TOKEN",
        slackBotTokenRef: "CUSTOM_SLACK_BOT_TOKEN",
        telegramBotTokenRef: "CUSTOM_TELEGRAM_BOT_TOKEN",
      }),
    ) as ReturnType<typeof clisbotConfigSchema.parse>;

    expect(config.bots.slack.default.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.bots.telegram.default.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("renders path defaults from CLISBOT_HOME", () => {
    process.env.CLISBOT_HOME = "~/.clisbot-dev";

    const config = JSON.parse(renderDefaultConfigTemplate()) as ReturnType<
      typeof clisbotConfigSchema.parse
    >;

    expect(config.app.session.storePath).toBe("~/.clisbot-dev/state/sessions.json");
    expect(config.agents.defaults.runner.defaults.tmux.socketPath).toBe(
      "~/.clisbot-dev/state/clisbot.sock",
    );
    expect(config.agents.defaults.workspace).toBe("~/.clisbot-dev/workspaces/{agentId}");
  });

  test("official config template validates and stays on the new top-level mental model", async () => {
    const text = readFileSync(
      new URL("../config/clisbot.json.template", import.meta.url),
      "utf8",
    );
    const parsed = JSON.parse(text);
    const config = clisbotConfigSchema.parse(parsed);

    expect(config.meta.schemaVersion).toBe("0.1.43");
    expect(Object.keys(config)).toEqual(["meta", "app", "bots", "agents"]);
    expect(config.bots.slack.defaults.defaultBotId).toBe("default");
    expect(config.bots.telegram.defaults.defaultBotId).toBe("default");

    const editable = await readEditableConfig(
      new URL("../config/clisbot.json.template", import.meta.url).pathname,
    );
    expect(editable.config.meta.schemaVersion).toBe("0.1.43");
  });
});

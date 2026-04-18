import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collapseHomePath, getDefaultConfigPath } from "../src/shared/paths.ts";
import {
  BOTS_AND_CREDENTIALS_DOC_PATH,
  getChannelAvailabilityForBootstrap,
  getDefaultChannelAvailability,
  hasAnyDefaultChannelToken,
  renderBootstrapTokenUsageLines,
  renderConfiguredChannelTokenStatusLines,
  renderConfiguredChannelTokenIssueLines,
  renderDisabledConfiguredChannelWarningLines,
  renderMissingTokenWarningLines,
} from "../src/control/startup-bootstrap.ts";
import { initConfig, start } from "../src/control/runtime-bootstrap-cli.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: false,
      }),
    ),
  );
  config.agents.list = [];
  config.app.control.configReload.watch = false;
  config.app.control.configReload.watchDebounceMs = 250;
  return config;
}

describe("startup bootstrap helpers", () => {
  test("prints focused init help without touching runtime state", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    try {
      await initConfig(["--help"]);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("clisbot init");
    expect(output).toContain("clisbot init --help");
    expect(output).toContain("literal token values on `init` require `--persist`");
  });

  test("prints focused start help without touching runtime state", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    try {
      await start(["--help"]);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("clisbot start");
    expect(output).toContain("clisbot start --help");
    expect(output).toContain("literal token values without `--persist` stay runtime-only");
  });

  test("detects default channel token availability", () => {
    expect(
      getDefaultChannelAvailability({
        SLACK_APP_TOKEN: "app",
        SLACK_BOT_TOKEN: "bot",
        TELEGRAM_BOT_TOKEN: "",
      }),
    ).toEqual({
      slack: true,
      telegram: false,
    });

    expect(
      getDefaultChannelAvailability({
        SLACK_APP_TOKEN: "",
        SLACK_BOT_TOKEN: "bot",
        TELEGRAM_BOT_TOKEN: "telegram",
      }),
    ).toEqual({
      slack: false,
      telegram: true,
    });
  });

  test("reports whether any default channel token is available", () => {
    expect(hasAnyDefaultChannelToken({ slack: false, telegram: false })).toBe(false);
    expect(hasAnyDefaultChannelToken({ slack: true, telegram: false })).toBe(true);
    expect(hasAnyDefaultChannelToken({ slack: false, telegram: true })).toBe(true);
  });

  test("treats explicit token placeholders as first-run channel availability only when the env value exists", () => {
    expect(
      getChannelAvailabilityForBootstrap(
        {
          slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
          slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
        },
        {
          CUSTOM_SLACK_APP_TOKEN: "app",
          CUSTOM_SLACK_BOT_TOKEN: "bot",
        },
      ),
    ).toEqual({
      slack: true,
      telegram: false,
    });

    expect(
      getChannelAvailabilityForBootstrap(
        {
          telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
        },
        {
          CUSTOM_TELEGRAM_BOT_TOKEN: "telegram",
        },
      ),
    ).toEqual({
      slack: false,
      telegram: true,
    });

    expect(
      getChannelAvailabilityForBootstrap(
        {
          slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
          slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
        },
        {},
      ),
    ).toEqual({
      slack: false,
      telegram: false,
    });
  });

  test("bootstrap token reporting only prints missing token lines", () => {
    expect(
      renderBootstrapTokenUsageLines(
        {
          slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
          slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
          telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
        },
        {
          CUSTOM_SLACK_APP_TOKEN: "app",
          CUSTOM_SLACK_BOT_TOKEN: "bot",
        },
      ),
    ).toEqual([
      "Telegram channel: token not found (CUSTOM_TELEGRAM_BOT_TOKEN), pass --telegram-bot-token explicitly for Telegram bootstrap.",
    ]);
  });

  test("warns when default tokens are present but the existing config keeps a channel disabled", () => {
    const config = createConfig();
    const configPath = collapseHomePath(getDefaultConfigPath());

    const lines = renderDisabledConfiguredChannelWarningLines(config, {
      slack: true,
      telegram: false,
    });

    expect(lines).toContain(
      "warning default Slack tokens are available in SLACK_APP_TOKEN and SLACK_BOT_TOKEN, but bots.slack.defaults.enabled is false in the existing config.",
    );
    expect(lines).toContain(
      `Run \`clisbot bots enable --channel slack --bot default\` to enable Slack quickly, or update ${configPath} manually.`,
    );
    expect(config.bots.slack.defaults.enabled).toBe(false);
  });

  test("does not warn when matching defaults are already enabled", () => {
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.telegram.defaults.enabled = true;

    const lines = renderDisabledConfiguredChannelWarningLines(config, {
      slack: true,
      telegram: true,
    });

    expect(lines).toEqual([]);
  });

  test("renders missing token guidance with repo and official docs", () => {
    const lines = renderMissingTokenWarningLines({}).join("\n");

    expect(lines).toContain(BOTS_AND_CREDENTIALS_DOC_PATH);
    expect(lines).toContain("--slack-app-token");
    expect(lines).toContain("SLACK_APP_TOKEN (missing)");
    expect(lines).toContain("TELEGRAM_BOT_TOKEN (missing)");
    expect(lines).toContain("https://api.slack.com/apps");
    expect(lines).toContain("https://core.telegram.org/bots#6-botfather");
  });

  test("reports missing env vars for enabled configured channels before runtime start", () => {
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";

    const tempHome = mkdtempSync(join(tmpdir(), "clisbot-startup-bootstrap-"));
    process.env.CLISBOT_HOME = tempHome;

    const lines = renderConfiguredChannelTokenIssueLines(config, {
      CLISBOT_HOME: tempHome,
      CUSTOM_SLACK_APP_TOKEN: "app",
    }).join("\n");

    expect(lines).toContain("warning!!! configured channel credentials are invalid or unavailable");
    expect(lines).toContain("Missing env var \"CUSTOM_SLACK_BOT_TOKEN\"");
    expect(lines).toContain("Missing env var \"CUSTOM_TELEGRAM_BOT_TOKEN\"");
    expect(lines).toContain(BOTS_AND_CREDENTIALS_DOC_PATH);
  });

  test("blocks start when any enabled channel still has missing token env refs", () => {
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.appToken = "${SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${SLACK_BOT_TOKEN}";
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.botToken = "${TELEGRAM_BOT_TOKEN}";

    const tempHome = mkdtempSync(join(tmpdir(), "clisbot-startup-bootstrap-"));
    process.env.CLISBOT_HOME = tempHome;

    const lines = renderConfiguredChannelTokenIssueLines(config, {
      CLISBOT_HOME: tempHome,
      TELEGRAM_BOT_TOKEN: "telegram-token",
    }).join("\n");

    expect(lines).toContain("warning!!! configured channel credentials are invalid or unavailable");
    expect(lines).toContain("Missing env var \"SLACK_APP_TOKEN\"");
  });

  test("reports whether configured tokens come from env refs or missing env values", () => {
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";

    const tempHome = mkdtempSync(join(tmpdir(), "clisbot-startup-bootstrap-"));
    process.env.CLISBOT_HOME = tempHome;

    const lines = renderConfiguredChannelTokenStatusLines(config, {
      CLISBOT_HOME: tempHome,
      CUSTOM_SLACK_APP_TOKEN: "app",
      CUSTOM_SLACK_BOT_TOKEN: "bot",
    }).join("\n");

    expect(lines).toContain(
      "Slack account default: source=env app=CUSTOM_SLACK_APP_TOKEN bot=CUSTOM_SLACK_BOT_TOKEN",
    );
    expect(lines).toContain(
      "Telegram account default: unavailable (Missing env var \"CUSTOM_TELEGRAM_BOT_TOKEN\" referenced at config path: bots.telegram.default.botToken)",
    );
  });

  test("reports mem credentials as ephemeral even when the current process does not own the secret", () => {
    const config = createConfig();
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default = {
      enabled: true,
      credentialType: "mem",
      botToken: "",
    } as any;

    expect(renderConfiguredChannelTokenIssueLines(config)).toEqual([]);
    expect(renderConfiguredChannelTokenStatusLines(config)).toContain(
      "Telegram account default: source=cli-ephemeral available=no restartRequiresPersistence=yes",
    );
  });
});

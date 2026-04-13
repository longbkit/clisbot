import { describe, expect, test } from "bun:test";
import {
  CHANNEL_ACCOUNT_DOC_PATH,
  getChannelAvailabilityForBootstrap,
  getDefaultChannelAvailability,
  hasAnyDefaultChannelToken,
  renderBootstrapTokenUsageLines,
  renderConfiguredChannelTokenStatusLines,
  renderConfiguredChannelTokenIssueLines,
  renderDisabledConfiguredChannelWarningLines,
  renderMissingTokenWarningLines,
} from "../src/control/startup-bootstrap.ts";
import type { ClisbotConfig } from "../src/config/schema.ts";

function createConfig(): ClisbotConfig {
  return JSON.parse(JSON.stringify({
    meta: {
      schemaVersion: 1,
    },
    tmux: {
      socketPath: "~/.clisbot/state/clisbot.sock",
    },
    session: {
      mainKey: "main",
      dmScope: "main",
      identityLinks: {},
      storePath: "~/.clisbot/state/sessions.json",
    },
    agents: {
      defaults: {
        workspace: "~/.clisbot/workspaces/{agentId}",
        runner: {
          command: "codex",
          args: ["-C", "{workspace}"],
          trustWorkspace: true,
          startupDelayMs: 1,
          promptSubmitDelayMs: 1,
          sessionId: {
            create: {
              mode: "runner",
              args: [],
            },
            capture: {
              mode: "off",
              statusCommand: "/status",
              pattern:
                "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
              timeoutMs: 1000,
              pollIntervalMs: 100,
            },
            resume: {
              mode: "off",
              args: ["resume", "{sessionId}", "-C", "{workspace}"],
            },
          },
        },
        stream: {
          captureLines: 10,
          updateIntervalMs: 10,
          idleTimeoutMs: 10,
          noOutputTimeoutMs: 10,
          maxRuntimeSec: 10,
          maxMessageChars: 100,
        },
        session: {
          createIfMissing: true,
          staleAfterMinutes: 60,
          name: "{sessionKey}",
        },
      },
      list: [],
    },
    bindings: [],
    control: {
      configReload: {
        watch: false,
        watchDebounceMs: 250,
      },
      sessionCleanup: {
        enabled: true,
        intervalMinutes: 5,
      },
    },
    channels: {
      slack: {
        enabled: false,
        mode: "socket",
        appToken: "${SLACK_APP_TOKEN}",
        botToken: "${SLACK_BOT_TOKEN}",
        defaultAccount: "default",
        accounts: {
          default: {
            appToken: "${SLACK_APP_TOKEN}",
            botToken: "${SLACK_BOT_TOKEN}",
          },
        },
        ackReaction: "",
        typingReaction: "",
        processingStatus: {
          enabled: true,
          status: "Working...",
          loadingMessages: [],
        },
        allowBots: false,
        replyToMode: "thread",
        channelPolicy: "allowlist",
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        privilegeCommands: {
          enabled: false,
          allowUsers: [],
        },
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
        },
        channels: {},
        groups: {},
        directMessages: {
          enabled: true,
          policy: "open",
          allowFrom: [],
          requireMention: false,
          agentId: "default",
        },
      },
      telegram: {
        enabled: false,
        mode: "polling",
        botToken: "${TELEGRAM_BOT_TOKEN}",
        defaultAccount: "default",
        accounts: {
          default: {
            botToken: "${TELEGRAM_BOT_TOKEN}",
          },
        },
        allowBots: false,
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        privilegeCommands: {
          enabled: false,
          allowUsers: [],
        },
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
        },
        polling: {
          timeoutSeconds: 20,
          retryDelayMs: 1000,
        },
        groups: {},
        directMessages: {
          enabled: true,
          policy: "open",
          allowFrom: [],
          requireMention: false,
          allowBots: false,
          agentId: "default",
        },
      },
    },
  })) as ClisbotConfig;
}

describe("startup bootstrap helpers", () => {
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

    const lines = renderDisabledConfiguredChannelWarningLines(config, {
      slack: true,
      telegram: false,
    });

    expect(lines).toContain(
      "warning default Slack tokens are available in SLACK_APP_TOKEN and SLACK_BOT_TOKEN, but channels.slack.enabled is false in the existing config.",
    );
    expect(lines).toContain("Run `clisbot channels enable slack` to enable Slack quickly, or update ~/.clisbot/clisbot.json manually.");
    expect(config.channels.slack.enabled).toBe(false);
  });

  test("does not warn when matching defaults are already enabled", () => {
    const config = createConfig();
    config.channels.slack.enabled = true;
    config.channels.telegram.enabled = true;

    const lines = renderDisabledConfiguredChannelWarningLines(config, {
      slack: true,
      telegram: true,
    });

    expect(lines).toEqual([]);
  });

  test("renders missing token guidance with repo and official docs", () => {
    const lines = renderMissingTokenWarningLines({}).join("\n");

    expect(lines).toContain(CHANNEL_ACCOUNT_DOC_PATH);
    expect(lines).toContain("--slack-app-token");
    expect(lines).toContain("SLACK_APP_TOKEN (missing)");
    expect(lines).toContain("TELEGRAM_BOT_TOKEN (missing)");
    expect(lines).toContain("https://api.slack.com/apps");
    expect(lines).toContain("https://core.telegram.org/bots#6-botfather");
  });

  test("reports missing env vars for enabled configured channels before runtime start", () => {
    const config = createConfig();
    config.channels.slack.enabled = true;
    config.channels.slack.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.channels.slack.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.channels.slack.accounts.default.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.channels.slack.accounts.default.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.channels.telegram.enabled = true;
    config.channels.telegram.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";
    config.channels.telegram.accounts.default.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";

    const lines = renderConfiguredChannelTokenIssueLines(config, {
      CUSTOM_SLACK_APP_TOKEN: "app",
    }).join("\n");

    expect(lines).toContain("warning!!! configured channel credentials are invalid or unavailable");
    expect(lines).toContain("Missing env var \"CUSTOM_SLACK_BOT_TOKEN\"");
    expect(lines).toContain("Missing env var \"CUSTOM_TELEGRAM_BOT_TOKEN\"");
    expect(lines).toContain(CHANNEL_ACCOUNT_DOC_PATH);
  });

  test("blocks start when any enabled channel still has missing token env refs", () => {
    const config = createConfig();
    config.channels.slack.enabled = true;
    config.channels.slack.appToken = "${SLACK_APP_TOKEN}";
    config.channels.slack.botToken = "${SLACK_BOT_TOKEN}";
    config.channels.slack.accounts.default.appToken = "${SLACK_APP_TOKEN}";
    config.channels.slack.accounts.default.botToken = "${SLACK_BOT_TOKEN}";
    config.channels.telegram.enabled = true;
    config.channels.telegram.botToken = "${TELEGRAM_BOT_TOKEN}";
    config.channels.telegram.accounts.default.botToken = "${TELEGRAM_BOT_TOKEN}";

    const lines = renderConfiguredChannelTokenIssueLines(config, {
      TELEGRAM_BOT_TOKEN: "telegram-token",
    }).join("\n");

    expect(lines).toContain("warning!!! configured channel credentials are invalid or unavailable");
    expect(lines).toContain("Missing env var \"SLACK_APP_TOKEN\"");
  });

  test("reports whether configured tokens come from env refs or missing env values", () => {
    const config = createConfig();
    config.channels.slack.enabled = true;
    config.channels.slack.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.channels.slack.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.channels.slack.accounts.default.appToken = "${CUSTOM_SLACK_APP_TOKEN}";
    config.channels.slack.accounts.default.botToken = "${CUSTOM_SLACK_BOT_TOKEN}";
    config.channels.telegram.enabled = true;
    config.channels.telegram.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";
    config.channels.telegram.accounts.default.botToken = "${CUSTOM_TELEGRAM_BOT_TOKEN}";

    const lines = renderConfiguredChannelTokenStatusLines(config, {
      CUSTOM_SLACK_APP_TOKEN: "app",
      CUSTOM_SLACK_BOT_TOKEN: "bot",
    }).join("\n");

    expect(lines).toContain(
      "Slack account default: source=env app=CUSTOM_SLACK_APP_TOKEN bot=CUSTOM_SLACK_BOT_TOKEN",
    );
    expect(lines).toContain(
      "Telegram account default: unavailable (Missing env var \"CUSTOM_TELEGRAM_BOT_TOKEN\" referenced at config path: channels.telegram.accounts.default.botToken)",
    );
  });

  test("reports mem credentials as ephemeral even when the current process does not own the secret", () => {
    const config = createConfig();
    config.channels.telegram.enabled = true;
    config.channels.telegram.botToken = "";
    config.channels.telegram.accounts.default = {
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

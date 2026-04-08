import { describe, expect, test } from "bun:test";
import { parseCliArgs, renderCliHelp } from "../src/cli.ts";

describe("parseCliArgs", () => {
  test("parses stop --hard", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "stop", "--hard"])).toEqual({
      name: "stop",
      hard: true,
    });
  });

  test("defaults to help with no command", () => {
    expect(parseCliArgs(["bun", "src/main.ts"])).toEqual({
      name: "help",
    });
  });

  test("parses status", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "status"])).toEqual({
      name: "status",
    });
  });

  test("parses logs with explicit line count", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "logs", "--lines", "50"])).toEqual({
      name: "logs",
      lines: 50,
    });
  });

  test("parses channels subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "channels", "enable", "slack"])).toEqual({
      name: "channels",
      args: ["enable", "slack"],
    });
  });

  test("parses agents subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "agents", "list", "--json"])).toEqual({
      name: "agents",
      args: ["list", "--json"],
    });
  });

  test("parses init", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "init"])).toEqual({
      name: "init",
    });
  });

  test("parses init bootstrap and token reference flags", () => {
    expect(
      parseCliArgs([
        "bun",
        "src/main.ts",
        "init",
        "--cli",
        "claude",
        "--bootstrap",
        "team-assistant",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ]),
    ).toEqual({
      name: "init",
      cliTool: "claude",
      bootstrap: "team-assistant",
      slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
      slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
      telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
    });
  });

  test("parses start bootstrap and token reference flags", () => {
    expect(
      parseCliArgs([
        "bun",
        "src/main.ts",
        "start",
        "--cli",
        "codex",
        "--bootstrap",
        "personal-assistant",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ]),
    ).toEqual({
      name: "start",
      cliTool: "codex",
      bootstrap: "personal-assistant",
      slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
      slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
      telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
    });
  });
});

describe("renderCliHelp", () => {
  test("includes lifecycle commands and npm usage", () => {
    const help = renderCliHelp();

    expect(help).toContain("muxbot start");
    expect(help).toContain("personal-assistant");
    expect(help).toContain("team-assistant");
    expect(help).toContain("SLACK_APP_TOKEN");
    expect(help).toContain("SLACK_BOT_TOKEN");
    expect(help).toContain("TELEGRAM_BOT_TOKEN");
    expect(help).toContain("uses standard env names automatically on first run");
    expect(help).toContain("One human gets one dedicated long-lived assistant workspace and session path");
    expect(help).toContain("One shared channel or group routes into one shared assistant workspace and session path");
    expect(help).toContain("muxbot start --cli codex --bootstrap personal-assistant");
    expect(help).toContain("muxbot restart");
    expect(help).toContain("muxbot stop [--hard]");
    expect(help).toContain("muxbot status");
    expect(help).toContain("muxbot logs [--lines N]");
    expect(help).toContain("muxbot channels <subcommand>");
    expect(help).toContain("muxbot agents <subcommand>");
    expect(help).toContain("muxbot init [--cli <codex|claude>] [--bootstrap <personal-assistant|team-assistant>]");
    expect(help).not.toContain("print-config-path");
    expect(help).toContain("npx muxbot start");
    expect(help).toContain("npm install -g muxbot && muxbot start");
    expect(help).toContain("Docs: docs/user-guide/README.md");
    expect(help).toContain("clone https://github.com/longbkit/muxbot");
    expect(help).toContain("Codex or Claude Code");
  });
});

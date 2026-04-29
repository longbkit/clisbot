import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseCliArgs, renderCliHelp } from "../src/cli.ts";
import { setRenderedCliName } from "../src/shared/cli-name.ts";
import { getClisbotVersion } from "../src/version.ts";

beforeEach(() => {
  setRenderedCliName();
});

afterEach(() => {
  setRenderedCliName();
});

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

  test("parses version command and flags", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "version"])).toEqual({
      name: "version",
    });
    expect(parseCliArgs(["bun", "src/main.ts", "--version"])).toEqual({
      name: "version",
    });
    expect(parseCliArgs(["bun", "src/main.ts", "-v"])).toEqual({
      name: "version",
    });
  });

  test("parses logs with explicit line count", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "logs", "--lines", "50"])).toEqual({
      name: "logs",
      lines: 50,
    });
  });

  test("parses update help command", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "update", "--help"])).toEqual({
      name: "update",
      args: ["--help"],
    });
  });

  test("parses channels subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "channels", "enable", "slack"])).toEqual({
      name: "channels",
      args: ["enable", "slack"],
    });
  });

  test("parses loops subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "loops", "cancel", "--all"])).toEqual({
      name: "loops",
      args: ["cancel", "--all"],
    });
  });

  test("parses message subcommands", () => {
    expect(
      parseCliArgs(["bun", "src/main.ts", "message", "send", "--channel", "slack"]),
    ).toEqual({
      name: "message",
      args: ["send", "--channel", "slack"],
    });
  });

  test("parses agents subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "agents", "list", "--json"])).toEqual({
      name: "agents",
      args: ["list", "--json"],
    });
  });

  test("parses timezone subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "timezone", "get"])).toEqual({
      name: "timezone",
      args: ["get"],
    });
  });

  test("parses auth subcommands", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "auth", "show", "app"])).toEqual({
      name: "auth",
      args: ["show", "app"],
    });
  });

  test("parses runner subcommands", () => {
    expect(
      parseCliArgs(["bun", "src/main.ts", "runner", "smoke", "--backend", "codex"]),
    ).toEqual({
      name: "runner",
      args: ["smoke", "--backend", "codex"],
    });
  });

  test("parses init", () => {
    expect(parseCliArgs(["bun", "src/main.ts", "init"])).toEqual({
      name: "init",
      args: [],
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
        "--bot-type",
        "team",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ]),
    ).toEqual({
      name: "init",
      args: [
        "--cli",
        "claude",
        "--bot-type",
        "team",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ],
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
        "--bot-type",
        "personal",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ]),
    ).toEqual({
      name: "start",
      args: [
        "--cli",
        "codex",
        "--bot-type",
        "personal",
        "--slack-app-token",
        "${CUSTOM_SLACK_APP_TOKEN}",
        "--slack-bot-token",
        "${CUSTOM_SLACK_BOT_TOKEN}",
        "--telegram-bot-token",
        "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      ],
    });
  });
});

describe("renderCliHelp", () => {
  test("includes lifecycle commands and npm usage", () => {
    const help = renderCliHelp();

    expect(help).toContain(`clisbot v${getClisbotVersion()}`);
    expect(help).toContain("Platform support:");
    expect(help).toContain("Linux/macOS  Supported.");
    expect(help).toContain("Windows      Native Windows is not supported yet. Use WSL2.");
    expect(help).toContain("clisbot start");
    expect(help).toContain("Bot types:");
    expect(help).toContain("personal  One human gets one dedicated long-lived assistant workspace and session path");
    expect(help).toContain("team      One shared channel or group routes into one shared assistant workspace and session path");
    expect(help).toContain("SLACK_APP_TOKEN");
    expect(help).toContain("SLACK_BOT_TOKEN");
    expect(help).toContain("TELEGRAM_BOT_TOKEN");
    expect(help).toContain("Fresh bootstrap only enables channels named by flags");
    expect(help).toContain("One human gets one dedicated long-lived assistant workspace and session path");
    expect(help).toContain("One shared channel or group routes into one shared assistant workspace and session path");
    expect(help).toContain("clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN");
    expect(help).toContain("clisbot restart");
    expect(help).toContain("clisbot stop [--hard]");
    expect(help).toContain("clisbot status");
    expect(help).toContain("Use `clisbot status` to see runtime state and the most recent runner sessions.");
    expect(help).toContain("clisbot runner watch --latest");
    expect(help).toContain("clisbot version");
    expect(help).toContain("clisbot logs [--lines N]");
    expect(help).toContain("clisbot update --help");
    expect(help).toContain("clisbot update --help");
    expect(help).toContain("clisbot bots <subcommand>");
    expect(help).toContain("clisbot bots --help");
    expect(help).not.toContain("get-group-policy|set-group-policy");
    expect(help).not.toContain("get-channel-policy|set-channel-policy");
    expect(help).toContain("clisbot start --help");
    expect(help).toContain("clisbot routes <subcommand>");
    expect(help).toContain("clisbot routes --help");
    expect(help).toContain("clisbot loops <subcommand>");
    expect(help).toContain("create --channel <slack|telegram> --target <route> [--thread-id <slack-thread-ts>] [--topic-id <telegram-topic-id>] [--new-thread] <expression>");
    expect(help).toContain("scoped status/cancel also accept --channel/--target/--thread-id/--topic-id");
    expect(help).toContain("`--target` selects the routed surface; use `--thread-id` for Slack threads, `--topic-id` for Telegram topics");
    expect(help).toContain("clisbot message <subcommand>");
    expect(help).toContain("clisbot agents <subcommand>");
    expect(help).toContain("clisbot agents --help");
    expect(help).toContain("clisbot auth <subcommand>");
    expect(help).toContain("clisbot auth --help");
    expect(help).toContain("clisbot runner <subcommand>");
    expect(help).toContain("clisbot runner --help");
    expect(help).toContain("runner shortcuts");
    expect(help).toContain("clisbot pairing --help");
    expect(help).toContain("clisbot init [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]");
    expect(help).not.toContain("print-config-path");
    expect(help).toContain("npx clisbot start");
    expect(help).toContain("npm install -g clisbot && clisbot start");
    expect(help).toContain("Docs: docs/user-guide/README.md");
    expect(help).toContain("clone https://github.com/longbkit/clisbot");
    expect(help).toContain("Codex or Claude Code");
    expect(help).toContain("cancel <id>");
    expect(help).toContain("loops --help");
  });

  test("switches operator command examples to clisbot-dev when configured", () => {
    setRenderedCliName("clisbot-dev");

    const help = renderCliHelp();

    expect(help).toContain(`clisbot-dev v${getClisbotVersion()}`);
    expect(help).toContain("clisbot-dev start");
    expect(help).toContain("clisbot-dev status");
    expect(help).not.toContain("npx clisbot start");
  });
});

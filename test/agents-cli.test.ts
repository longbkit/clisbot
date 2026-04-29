import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentsCli } from "../src/control/agents-cli.ts";

describe("agents cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  let previousCliName: string | undefined;
  const originalLog = console.log;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
  });

  afterEach(() => {
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_CLI_NAME = previousCliName;
    console.log = originalLog;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("adds an agent with cli defaults, bootstrap files, and bindings", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli([
      "add",
      "default",
      "--cli",
      "codex",
      "--workspace",
      join(tempDir, "workspaces", "default"),
      "--bot-type",
      "personal",
      "--bind",
      "slack",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          id: string;
          cli?: string;
          bootstrap?: { botType: string };
          runner?: { command: string; args: string[] };
        }>;
      };
    };

    expect(rawConfig.agents.list).toHaveLength(1);
    expect(rawConfig.agents.list[0]?.id).toBe("default");
    expect(rawConfig.agents.list[0]?.cli).toBe("codex");
    expect(rawConfig.agents.list[0]?.runner).toBeUndefined();
    expect(rawConfig.agents.list[0]?.bootstrap?.botType).toBe("personal-assistant");
    expect(existsSync(join(tempDir, "workspaces", "default", "BOOTSTRAP.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "LOOP.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "CLAUDE.md"))).toBe(false);
    expect(output.join("\n")).toContain("Added agent default with tool codex.");
  });

  test("prints focused help", async () => {
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["help"]);

    const text = output.join("\n");
    expect(text).toContain("clisbot agents");
    expect(text).toContain("clisbot agents help");
    expect(text).toContain("clisbot agents add <id> --cli <codex|claude|gemini>");
    expect(text).toContain("`agents add` is the lower-level manual surface");
  });

  test("team-assistant bootstrap overrides base USER.md with the team template", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    await runAgentsCli([
      "add",
      "team",
      "--cli",
      "codex",
      "--workspace",
      join(tempDir, "workspaces", "team"),
      "--bot-type",
      "team",
    ]);

    const userMd = readFileSync(
      join(tempDir, "workspaces", "team", "USER.md"),
      "utf8",
    );

    expect(userMd).toContain("# USER.md - About The Team");
    expect(userMd).toContain("Do not treat this as a private personal profile for one individual.");
    expect(userMd).not.toContain("# USER.md - About Your Human");
  });

  test("inherits runner defaults when the selected tool differs from the global default", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    await runAgentsCli(["add", "work", "--cli", "claude"]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          id: string;
          cli?: string;
          runner?: { command: string; args: string[] };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.cli).toBe("claude");
    expect(rawConfig.agents.list[0]?.runner).toBeUndefined();
  });

  test("adds a gemini agent with tool-specific runner defaults and bootstrap files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    await runAgentsCli([
      "add",
      "gem",
      "--cli",
      "gemini",
      "--workspace",
      join(tempDir, "workspaces", "gem"),
      "--bot-type",
      "team",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          cli?: string;
          runner?: {
            command: string;
            args: string[];
            startupReadyPattern?: string;
            startupBlockers?: Array<{
              pattern: string;
              message: string;
            }>;
          };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.cli).toBe("gemini");
    expect(rawConfig.agents.list[0]?.runner).toBeUndefined();
    expect(existsSync(join(tempDir, "workspaces", "gem", "GEMINI.md"))).toBe(true);
  });

  test("keeps startup option and runner overrides when startup options differ from tool defaults", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    await runAgentsCli([
      "add",
      "custom",
      "--cli",
      "codex",
      "--startup-option",
      "--dangerously-bypass-approvals-and-sandbox",
      "--startup-option",
      "--model",
      "--startup-option",
      "gpt-5",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          cli?: string;
          runner?: { command: string; args: string[] };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.cli).toBe("codex");
    expect(rawConfig.agents.list[0]?.runner?.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5",
      "-C",
      "{workspace}",
    ]);
    expect(rawConfig.agents.list[0]?.runner?.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5",
      "-C",
      "{workspace}",
    ]);
  });

  test("lists bindings for configured agents", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude", "--bind", "telegram"]);
    output.length = 0;
    await runAgentsCli(["bindings"]);

    expect(output.join("\n")).toContain("Agent bindings are no longer managed here.");
  });

  test("sets, shows, and clears agent responseMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude"]);
    output.length = 0;

    await runAgentsCli(["response-mode", "set", "capture-pane", "--agent", "work"]);

    let rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{ id: string; responseMode?: string }>;
      };
    };

    expect(rawConfig.agents.list[0]?.responseMode).toBe("capture-pane");
    expect(output.join("\n")).toContain("updated responseMode for work");

    output.length = 0;
    await runAgentsCli(["response-mode", "status", "--agent", "work"]);
    expect(output.join("\n")).toContain("responseMode: capture-pane");

    output.length = 0;
    await runAgentsCli(["response-mode", "clear", "--agent", "work"]);
    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.list[0]?.responseMode).toBeUndefined();
    expect(output.join("\n")).toContain("cleared responseMode for work");
  });

  test("sets, shows, and clears agent additionalMessageMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude"]);
    output.length = 0;

    await runAgentsCli(["additional-message-mode", "set", "queue", "--agent", "work"]);

    let rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{ id: string; additionalMessageMode?: string }>;
      };
    };

    expect(rawConfig.agents.list[0]?.additionalMessageMode).toBe("queue");
    expect(output.join("\n")).toContain("updated additionalMessageMode for work");

    output.length = 0;
    await runAgentsCli(["additional-message-mode", "status", "--agent", "work"]);
    expect(output.join("\n")).toContain("additionalMessageMode: queue");

    output.length = 0;
    await runAgentsCli(["additional-message-mode", "clear", "--agent", "work"]);
    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.list[0]?.additionalMessageMode).toBeUndefined();
    expect(output.join("\n")).toContain("cleared additionalMessageMode for work");
  });

  test("sets and clears agent timezone override", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude"]);
    await runAgentsCli(["set-timezone", "--agent", "work", "America/Los_Angeles"]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.list[0]?.timezone).toBe("America/Los_Angeles");

    await runAgentsCli(["clear-timezone", "--agent", "work"]);
    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.list[0]?.timezone).toBeUndefined();
  });

  test("lists agent responseMode state", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude"]);
    output.length = 0;
    await runAgentsCli(["list"]);

    expect(output.join("\n")).toContain("responseMode=inherit");
    expect(output.join("\n")).toContain("additionalMessageMode=inherit");
  });

  test("bootstrap refuses overwrite without force and can overwrite with force", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli([
      "add",
      "work",
      "--cli",
      "claude",
      "--workspace",
      join(tempDir, "workspaces", "work"),
    ]);

    const workspacePath = join(tempDir, "workspaces", "work");
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(join(workspacePath, "IDENTITY.md"), "custom identity\n");

    await expect(
      runAgentsCli(["bootstrap", "work", "--bot-type", "team"]),
    ).rejects.toThrow("Run again with --force to overwrite.");

    expect(readFileSync(join(workspacePath, "IDENTITY.md"), "utf8")).toBe("custom identity\n");

    await runAgentsCli(["bootstrap", "work", "--bot-type", "team", "--force"]);

    expect(existsSync(join(workspacePath, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(workspacePath, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(workspacePath, "LOOP.md"))).toBe(true);
    expect(readFileSync(join(workspacePath, "IDENTITY.md"), "utf8")).not.toBe("custom identity\n");
    expect(output.join("\n")).toContain("Rebootstrapped agent work with claude/team-assistant");
  });

  test("rejects legacy agent bootstrap flags", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-agents-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    await expect(
      runAgentsCli(["add", "legacy", "--cli", "codex", "--bootstrap", "personal-assistant"]),
    ).rejects.toThrow(
      "agents add no longer accepts --bootstrap; use --bot-type personal or --bot-type team",
    );

    await runAgentsCli(["add", "work", "--cli", "claude"]);

    await expect(
      runAgentsCli(["bootstrap", "work", "--mode", "team-assistant"]),
    ).rejects.toThrow(
      "agents bootstrap no longer accepts --mode; use --bot-type personal or --bot-type team",
    );
  });
});

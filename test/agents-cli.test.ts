import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentsCli } from "../src/control/agents-cli.ts";

describe("agents cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  const originalLog = console.log;

  afterEach(() => {
    process.env.MUXBOT_CONFIG_PATH = previousConfigPath;
    console.log = originalLog;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("adds an agent with cli defaults, bootstrap files, and bindings", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");
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
      "--bootstrap",
      "personal-assistant",
      "--bind",
      "slack",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.MUXBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          id: string;
          cliTool?: string;
          startupOptions?: string[];
          bootstrap?: { mode: string };
          runner?: { command: string; args: string[] };
        }>;
      };
      bindings: Array<{ match: { channel: string }; agentId: string }>;
    };

    expect(rawConfig.agents.list).toHaveLength(1);
    expect(rawConfig.agents.list[0]?.id).toBe("default");
    expect(rawConfig.agents.list[0]?.cliTool).toBe("codex");
    expect(rawConfig.agents.list[0]?.startupOptions).toBeUndefined();
    expect(rawConfig.agents.list[0]?.runner).toBeUndefined();
    expect(rawConfig.agents.list[0]?.bootstrap?.mode).toBe("personal-assistant");
    expect(rawConfig.bindings).toEqual([
      {
        match: {
          channel: "slack",
        },
        agentId: "default",
      },
    ]);
    expect(existsSync(join(tempDir, "workspaces", "default", "BOOTSTRAP.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "default", "CLAUDE.md"))).toBe(false);
    expect(output.join("\n")).toContain("Added agent default with tool codex.");
  });

  test("team-assistant bootstrap overrides base USER.md with the team template", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");

    await runAgentsCli([
      "add",
      "team",
      "--cli",
      "codex",
      "--workspace",
      join(tempDir, "workspaces", "team"),
      "--bootstrap",
      "team-assistant",
    ]);

    const userMd = readFileSync(
      join(tempDir, "workspaces", "team", "USER.md"),
      "utf8",
    );

    expect(userMd).toContain("# USER.md - About The Team");
    expect(userMd).toContain("Do not treat this as a private personal profile for one individual.");
    expect(userMd).not.toContain("# USER.md - About Your Human");
  });

  test("keeps runner override when the selected tool differs from defaults", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");

    await runAgentsCli(["add", "work", "--cli", "claude"]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.MUXBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          id: string;
          cliTool?: string;
          startupOptions?: string[];
          runner?: { command: string; args: string[] };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.cliTool).toBe("claude");
    expect(rawConfig.agents.list[0]?.startupOptions).toBeUndefined();
    expect(rawConfig.agents.list[0]?.runner?.command).toBe("claude");
    expect(rawConfig.agents.list[0]?.runner?.args).toEqual(["--dangerously-skip-permissions"]);
  });

  test("keeps startup option and runner overrides when startup options differ from tool defaults", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");

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
      readFileSync(process.env.MUXBOT_CONFIG_PATH!, "utf8"),
    ) as {
      agents: {
        list: Array<{
          startupOptions?: string[];
          runner?: { command: string; args: string[] };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.startupOptions).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5",
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
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");
    const output: string[] = [];
    console.log = ((value: string) => {
      output.push(value);
    }) as typeof console.log;

    await runAgentsCli(["add", "work", "--cli", "claude", "--bind", "telegram"]);
    output.length = 0;
    await runAgentsCli(["bindings"]);

    expect(output.join("\n")).toContain("telegram -> work");
  });

  test("bootstrap refuses overwrite without force and can overwrite with force", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-agents-cli-"));
    previousConfigPath = process.env.MUXBOT_CONFIG_PATH;
    process.env.MUXBOT_CONFIG_PATH = join(tempDir, "muxbot.json");
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
      runAgentsCli(["bootstrap", "work", "--mode", "team-assistant"]),
    ).rejects.toThrow("Run again with --force to overwrite.");

    expect(readFileSync(join(workspacePath, "IDENTITY.md"), "utf8")).toBe("custom identity\n");

    await runAgentsCli(["bootstrap", "work", "--mode", "team-assistant", "--force"]);

    expect(existsSync(join(workspacePath, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(workspacePath, "AGENTS.md"))).toBe(false);
    expect(readFileSync(join(workspacePath, "IDENTITY.md"), "utf8")).not.toBe("custom identity\n");
    expect(output.join("\n")).toContain("Rebootstrapped agent work with claude/team-assistant");
  });
});

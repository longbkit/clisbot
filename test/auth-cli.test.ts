import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { runAuthCli } from "../src/control/auth-cli.ts";

describe("auth cli", () => {
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

  test("adds and removes users on app roles", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runAuthCli([
      "add-user",
      "app",
      "--role",
      "owner",
      "--user",
      "telegram:1276408333",
    ]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8")) as {
      app: {
        auth: {
          roles: Record<string, { users: string[] }>;
        };
      };
    };

    expect(rawConfig.app.auth.roles.owner?.users).toContain("telegram:1276408333");

    await runAuthCli([
      "remove-user",
      "app",
      "--role",
      "owner",
      "--user",
      "telegram:1276408333",
    ]);

    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.app.auth.roles.owner?.users).not.toContain("telegram:1276408333");
  });

  test("adds and removes permissions on app roles", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runAuthCli([
      "remove-permission",
      "app",
      "--role",
      "admin",
      "--permission",
      "promptGovernanceManage",
    ]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8")) as {
      app: {
        auth: {
          roles: Record<string, { allow: string[] }>;
        };
      };
    };

    expect(rawConfig.app.auth.roles.admin?.allow).not.toContain("promptGovernanceManage");

    await runAuthCli([
      "add-permission",
      "app",
      "--role",
      "admin",
      "--permission",
      "promptGovernanceManage",
    ]);

    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.app.auth.roles.admin?.allow).toContain("promptGovernanceManage");
  });

  test("adds and removes users on one agent role override", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    await runAuthCli([
      "add-user",
      "agent",
      "--agent",
      "default",
      "--role",
      "admin",
      "--user",
      "slack:U123",
    ]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8")) as {
      agents: {
        list: Array<{
          id: string;
          auth?: {
            roles: Record<string, { users: string[]; allow: string[] }>;
          };
        }>;
      };
    };

    const agentRole = rawConfig.agents.list[0]?.auth?.roles?.admin;
    expect(agentRole?.users).toContain("slack:U123");
    expect(agentRole?.allow).toContain("shellExecute");

    await runAuthCli([
      "remove-user",
      "agent",
      "--agent",
      "default",
      "--role",
      "admin",
      "--user",
      "slack:U123",
    ]);

    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.list[0]?.auth?.roles?.admin?.users).not.toContain("slack:U123");
  });

  test("adds and removes permissions on agent-defaults roles", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runAuthCli([
      "add-permission",
      "agent-defaults",
      "--role",
      "member",
      "--permission",
      "shellExecute",
    ]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8")) as {
      agents: {
        defaults: {
          auth: {
            roles: Record<string, { allow: string[] }>;
          };
        };
      };
    };

    expect(rawConfig.agents.defaults.auth.roles.member?.allow).toContain("shellExecute");

    await runAuthCli([
      "remove-permission",
      "agent-defaults",
      "--role",
      "member",
      "--permission",
      "shellExecute",
    ]);

    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.agents.defaults.auth.roles.member?.allow).not.toContain("shellExecute");
  });

  test("prints help when no auth subcommand is provided", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runAuthCli([]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot auth");
    expect(output).toContain("add-user");
    expect(output).toContain("add-permission");
    expect(output).toContain("agent-defaults");
    expect(output).toContain("Scopes:");
    expect(output).toContain("Permission sets:");
    expect(output).toContain("roles.<role>.allow");
    expect(output).toContain("configManage");
    expect(output).toContain("shellExecute");
    expect(output).toContain("bypass DM pairing automatically");
  });

  test("rejects unknown permissions with the allowed set in the error", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await expect(
      runAuthCli([
        "add-permission",
        "app",
        "--role",
        "admin",
        "--permission",
        "shellExecute",
      ]),
    ).rejects.toThrow("Allowed: agentAuthManage, appAuthManage, configManage, promptGovernanceManage");
  });

  test("adds a permission on one agent by cloning the inherited role first", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    await runAuthCli([
      "add-permission",
      "agent",
      "--agent",
      "default",
      "--role",
      "member",
      "--permission",
      "shellExecute",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8")) as {
      agents: {
        list: Array<{
          id: string;
          auth?: {
            roles: Record<string, { users: string[]; allow: string[] }>;
          };
        }>;
      };
    };

    expect(rawConfig.agents.list[0]?.auth?.roles?.member?.allow).toContain("sendMessage");
    expect(rawConfig.agents.list[0]?.auth?.roles?.member?.allow).toContain("shellExecute");
  });

  test("lists configured agents even when they only inherit auth defaults", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }, { id: "ops" }];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runAuthCli(["list", "--json"]);

    const output = JSON.parse(logs.join("\n")) as {
      agents: Array<{ agentId: string }>;
    };

    expect(output.agents.map((entry) => entry.agentId)).toEqual(["default", "ops"]);
  });

  test("shows effective agent auth when an override role only customizes users", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [
      {
        id: "default",
        auth: {
          defaultRole: "member",
          roles: {
            member: {
              users: ["slack:U123"],
            },
          },
        },
      },
    ];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runAuthCli(["show", "agent", "--agent", "default", "--json"]);

    const output = JSON.parse(logs.join("\n")) as {
      roles: Record<string, { allow: string[]; users: string[] }>;
    };

    expect(output.roles.member?.users).toEqual(["slack:U123"]);
    expect(output.roles.member?.allow).toContain("sendMessage");
  });

  test("gets effective sender permissions with dynamic explanations", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runAuthCli([
      "get-permissions",
      "--sender",
      "telegram:1276408333",
      "--agent",
      "default",
      "--json",
    ]);

    const output = JSON.parse(logs.join("\n")) as {
      sender: string;
      permissions: Record<string, { allowed: boolean; explanation: string }>;
      resolution?: unknown;
    };

    expect(output.sender).toBe("telegram:1276408333");
    expect(output.permissions.manageLoop.allowed).toBe(true);
    expect(output.permissions.manageLoop.explanation).toStartWith("Can ");
    expect(output.permissions.runShellSlashCommand.allowed).toBe(false);
    expect(output.permissions.runShellSlashCommand.explanation).toStartWith("Cannot ");
    expect(output.permissions.runShellSlashCommand.explanation).toContain("/bash");
    expect(output.permissions.runShellSlashCommand.explanation).toContain("workspace file reads/edits are separate");
    expect(output.resolution).toBeUndefined();
  });

  test("gets verbose sender permission resolution details", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-auth-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }];
    config.app.auth.roles.owner.users = ["telegram:1276408333"];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runAuthCli([
      "get-permissions",
      "--sender",
      "telegram:1276408333",
      "--agent",
      "default",
      "--json",
      "--verbose",
    ]);

    const output = JSON.parse(logs.join("\n")) as {
      permissions: Record<string, { allowed: boolean; explanation: string }>;
      resolution?: { appRole?: string; effective?: { mayManageProtectedResources?: boolean } };
    };

    expect(output.permissions.manageProtectedResources.allowed).toBe(true);
    expect(output.permissions.manageProtectedResources.explanation).toStartWith("Can ");
    expect(output.resolution?.appRole).toBe("owner");
    expect(output.resolution?.effective?.mayManageProtectedResources).toBe(true);
  });
});

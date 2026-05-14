import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimFirstOwnerFromDirectMessage,
  isOwnerClaimOpen,
  primeOwnerClaimRuntime,
  renderFirstOwnerClaimMessage,
  resetOwnerClaimRuntimeForTests,
} from "../src/auth/owner-claim.ts";
import { readEditableConfig, writeEditableConfig } from "../src/config/core/config-file.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.auth.roles.admin.allow = ["configManage", "appAuthManage"];
  config.agents.defaults.auth.roles.admin.allow = ["sendMessage", "shellExecute"];
  config.agents.defaults.auth.roles.member.allow = ["sendMessage"];
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  return config;
}

describe("owner claim", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    resetOwnerClaimRuntimeForTests();
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-owner-claim-"));
    configPath = join(tempDir, "clisbot.json");
    await writeEditableConfig(configPath, createConfig());
  });

  afterEach(() => {
    resetOwnerClaimRuntimeForTests();
  });

  test("claims the first owner from the first DM during the claim window", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "telegram",
        conversationKind: "dm",
        senderId: "1276408333",
        chatId: "1276408333",
      },
      nowMs: 5_000,
    });

    expect(result).toMatchObject({
      claimed: true,
      principal: "telegram:1276408333",
    });
    expect(config.app.auth.roles.owner.users).toEqual(["telegram:1276408333"]);

    const persisted = await readEditableConfig(configPath);
    expect(persisted.config.app.auth.roles.owner.users).toEqual([
      "telegram:1276408333",
    ]);
    expect(isOwnerClaimOpen(config, 5_001)).toBe(false);
  });

  test("does not claim outside direct messages", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        channelId: "C123",
      },
      nowMs: 2_000,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("does not reopen owner claim until the next runtime after an owner existed", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "UOWNER",
        channelId: "D123",
      },
      nowMs: 2_000,
    });

    config.app.auth.roles.owner.users = [];
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "telegram",
        conversationKind: "dm",
        senderId: "555",
        chatId: "555",
      },
      nowMs: 3_000,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("expires the owner claim window without mutating config", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 0);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "ULATE",
        channelId: "D1",
      },
      nowMs: 30 * 60_000 + 1,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("renders a clear first-owner claim acknowledgement", () => {
    const text = renderFirstOwnerClaimMessage({
      principal: "telegram:1276408333",
      ownerClaimWindowMinutes: 30,
    });

    expect(text).toContain("First owner claim complete.");
    expect(text).toContain("principal: `telegram:1276408333`");
    expect(text).toContain("role: `owner`");
    expect(text).toContain("first direct message received during the first 30 minutes");
    expect(text).toContain("pairing: not required for you anymore because app owners bypass DM pairing");
    expect(text).toContain("- chat without pairing approval");
    expect(text).toContain("- manage auth, channels, and agent settings");
  });
});

import { describe, expect, test } from "bun:test";
import { resolveChannelAuth } from "../src/auth/resolve.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.auth.roles.admin.allow = ["configManage", "appAuthManage"];
  config.app.auth.roles.admin.users = ["slack:UADMIN"];
  config.agents.defaults.auth.roles.admin.allow = ["sendMessage", "shellExecute"];
  config.agents.defaults.auth.roles.admin.users = ["slack:UOPS"];
  config.agents.defaults.auth.roles.member.allow = ["sendMessage"];
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.bots.defaults.dmScope = "main";
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  return config;
}

describe("resolveChannelAuth", () => {
  test("grants app admins pairing bypass and protected-resource management", () => {
    const auth = resolveChannelAuth({
      config: createConfig(),
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "UADMIN",
      },
    });

    expect(auth.appRole).toBe("admin");
    expect(auth.mayBypassPairing).toBe(true);
    expect(auth.mayBypassSharedSenderPolicy).toBe(true);
    expect(auth.mayManageProtectedResources).toBe(true);
    expect(auth.canUseShell).toBe(true);
  });

  test("grants shell only when the resolved agent role allows it", () => {
    const auth = resolveChannelAuth({
      config: createConfig(),
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "UOPS",
      },
    });

    expect(auth.appRole).toBe("member");
    expect(auth.agentRole).toBe("admin");
    expect(auth.mayBypassPairing).toBe(false);
    expect(auth.mayBypassSharedSenderPolicy).toBe(false);
    expect(auth.mayManageProtectedResources).toBe(false);
    expect(auth.canUseShell).toBe(true);
  });

  test("keeps inherited permissions when an agent role override only changes users", () => {
    const config = createConfig();
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

    const auth = resolveChannelAuth({
      config,
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
      },
    });

    expect(auth.agentRole).toBe("member");
    expect(auth.mayBypassPairing).toBe(false);
    expect(auth.mayBypassSharedSenderPolicy).toBe(false);
    expect(auth.canUseShell).toBe(false);
  });

  test("requires pairing for non-owner principals even when agent send permissions exist", () => {
    const auth = resolveChannelAuth({
      config: createConfig(),
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "UOPS",
      },
    });

    expect(auth.appRole).toBe("member");
    expect(auth.agentRole).toBe("admin");
    expect(auth.mayBypassPairing).toBe(false);
    expect(auth.mayBypassSharedSenderPolicy).toBe(false);
    expect(auth.canUseShell).toBe(true);
  });
});

// upstream: src/channels/plugins/message-capability-matrix.test.ts@5d8067a4483
// Message capability matrix tests cover channel message feature support across plugin surfaces.
import { afterEach, describe, expect, it, vi } from "vitest";
// D-CORE-011: upstream boots the real channel plugins through the OpenClaw
// plugin registry. Fusion keeps the matrix on local stubs of the same shape;
// the assertions are unchanged.
import type { ChannelMessageCapability } from "./message-capabilities.js";
import type { ChannelPlugin, OpenClawConfig } from "./types.public.js";
const telegramDescribeMessageToolMock = vi.fn();
const discordDescribeMessageToolMock = vi.fn();
const telegramPlugin: ChannelPlugin = {
  id: "telegram",
  actions: {
    describeMessageTool: ({ cfg }) => telegramDescribeMessageToolMock({ cfg }),
    supportsAction: () => true,
  },
};
const discordPlugin: ChannelPlugin = {
  id: "discord",
  actions: {
    describeMessageTool: ({ cfg }) => discordDescribeMessageToolMock({ cfg }),
    supportsAction: () => true,
  },
};
// Keep this matrix focused on capability wiring. The extension packages already
// cover their own full channel/plugin boot paths, so local stubs are enough here.
const slackPlugin: ChannelPlugin = {
  id: "slack",
  actions: {
    describeMessageTool: ({ cfg }) => {
      const account = cfg.channels?.slack;
      const enabled =
        typeof account?.botToken === "string" &&
        account.botToken.trim() !== "" &&
        typeof account?.appToken === "string" &&
        account.appToken.trim() !== "";
      const capabilities = new Set<ChannelMessageCapability>();
      if (enabled) {
        capabilities.add("presentation");
      }
      return {
        actions: enabled ? ["send"] : [],
        capabilities: Array.from(capabilities),
      };
    },
    supportsAction: () => true,
  },
};
const mattermostPlugin: ChannelPlugin = {
  id: "mattermost",
  actions: {
    describeMessageTool: ({ cfg }) => {
      const account = cfg.channels?.mattermost;
      const enabled =
        account?.enabled !== false &&
        typeof account?.botToken === "string" &&
        account.botToken.trim() !== "" &&
        typeof account?.baseUrl === "string" &&
        account.baseUrl.trim() !== "";
      return {
        actions: enabled ? ["send"] : [],
        capabilities: enabled ? ["presentation"] : [],
      };
    },
    supportsAction: () => true,
  },
};
const feishuPlugin: ChannelPlugin = {
  id: "feishu",
  actions: {
    describeMessageTool: ({ cfg }) => {
      const account = cfg.channels?.feishu;
      const enabled =
        account?.enabled !== false &&
        typeof account?.appId === "string" &&
        account.appId.trim() !== "" &&
        typeof account?.appSecret === "string" &&
        account.appSecret.trim() !== "";
      return {
        actions: enabled ? ["send"] : [],
        capabilities: enabled ? ["presentation"] : [],
      };
    },
    supportsAction: () => true,
  },
};
const msteamsPlugin: ChannelPlugin = {
  id: "msteams",
  actions: {
    describeMessageTool: ({ cfg }) => {
      const account = cfg.channels?.msteams;
      const enabled =
        account?.enabled !== false &&
        typeof account?.tenantId === "string" &&
        account.tenantId.trim() !== "" &&
        typeof account?.appId === "string" &&
        account.appId.trim() !== "" &&
        typeof account?.appPassword === "string" &&
        account.appPassword.trim() !== "";
      return {
        actions: enabled ? ["poll"] : [],
        capabilities: enabled ? ["presentation"] : [],
      };
    },
    supportsAction: () => true,
  },
};
const zaloPlugin: ChannelPlugin = {
  id: "zalo",
  actions: {
    describeMessageTool: () => ({ actions: [], capabilities: [] }),
    supportsAction: () => true,
  },
};
describe("channel action capability matrix", () => {
  afterEach(() => {
    telegramDescribeMessageToolMock.mockReset();
    discordDescribeMessageToolMock.mockReset();
  });
  function getCapabilities(plugin: ChannelPlugin, cfg: OpenClawConfig): ChannelMessageCapability[] {
    const describeMessageTool = plugin.actions?.describeMessageTool;
    return [...(describeMessageTool?.({ cfg })?.capabilities ?? [])];
  }
  it("exposes Slack presentation when configured", () => {
    const baseCfg = {
      channels: {
        slack: {
          botToken: "xoxb-test",
          appToken: "xapp-test",
        },
      },
    };
    expect(getCapabilities(slackPlugin, baseCfg)).toEqual(["presentation"]);
  });
  it("forwards Telegram action capabilities through the channel wrapper", () => {
    telegramDescribeMessageToolMock.mockReturnValue({
      capabilities: ["presentation"],
    });
    const result = getCapabilities(telegramPlugin, {});
    expect(result).toEqual(["presentation"]);
    expect(telegramDescribeMessageToolMock).toHaveBeenCalledWith({ cfg: {} });
    discordDescribeMessageToolMock.mockReturnValue({
      capabilities: ["presentation"],
    });
    const discordResult = getCapabilities(discordPlugin, {});
    expect(discordResult).toEqual(["presentation"]);
    expect(discordDescribeMessageToolMock).toHaveBeenCalledWith({ cfg: {} });
  });
  it("exposes configured channel capabilities only when required credentials are present", () => {
    const configuredCfg = {
      channels: {
        mattermost: {
          enabled: true,
          botToken: "mm-token",
          baseUrl: "https://chat.example.com",
        },
      },
    };
    const unconfiguredCfg = {
      channels: {
        mattermost: {
          enabled: true,
        },
      },
    };
    const configuredFeishuCfg = {
      channels: {
        feishu: {
          enabled: true,
          appId: "cli_a",
          appSecret: "secret",
        },
      },
    };
    const disabledFeishuCfg = {
      channels: {
        feishu: {
          enabled: false,
          appId: "cli_a",
          appSecret: "secret",
        },
      },
    };
    const configuredMsteamsCfg = {
      channels: {
        msteams: {
          enabled: true,
          tenantId: "tenant",
          appId: "app",
          appPassword: "secret",
        },
      },
    };
    const disabledMsteamsCfg = {
      channels: {
        msteams: {
          enabled: false,
          tenantId: "tenant",
          appId: "app",
          appPassword: "secret",
        },
      },
    };
    expect(getCapabilities(mattermostPlugin, configuredCfg)).toEqual(["presentation"]);
    expect(getCapabilities(mattermostPlugin, unconfiguredCfg)).toStrictEqual([]);
    expect(getCapabilities(feishuPlugin, configuredFeishuCfg)).toEqual(["presentation"]);
    expect(getCapabilities(feishuPlugin, disabledFeishuCfg)).toStrictEqual([]);
    expect(getCapabilities(msteamsPlugin, configuredMsteamsCfg)).toEqual(["presentation"]);
    expect(getCapabilities(msteamsPlugin, disabledMsteamsCfg)).toStrictEqual([]);
  });
  it("keeps Zalo actions on the empty capability set", () => {
    const cfg = {
      channels: {
        zalo: {
          enabled: true,
          botToken: "zl-token",
        },
      },
    };
    expect(getCapabilities(zaloPlugin, cfg)).toStrictEqual([]);
  });
});

// upstream: extensions/slack/src/message-actions.secretref.test.ts@5d8067a4483
// Slack tests cover account-isolated message-tool discovery.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { listSlackMessageActions } from "./message-actions.js";

describe("Slack message actions with an unavailable account SecretRef", () => {
  const cfg = {
    channels: {
      slack: {
        accounts: {
          broken: {
            botToken: {
              source: "env",
              provider: "default",
              id: "OPENCLAW_TEST_MISSING_SLACK_BOT_TOKEN",
            },
          },
          healthy: { botToken: "xoxb-healthy" },
        },
      },
    },
  } as OpenClawConfig;

  it("keeps healthy account actions discoverable", () => {
    expect(listSlackMessageActions(cfg)).toContain("send");
  });

  it("does not advertise actions for the unavailable selected account", () => {
    expect(listSlackMessageActions(cfg, "broken")).toEqual([]);
  });
});

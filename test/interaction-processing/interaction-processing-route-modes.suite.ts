import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../../src/channels/message/interaction-processing.ts";
import type { AgentSessionTarget } from "../../src/agents/runtime/agent-service.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { sleep } from "../../src/infra/process.ts";
import {
  createIdentity,
  createRoute,
  createTarget,
  createTelegramTopicIdentity,
  createTelegramTopicTarget,
  registerCliNameIsolation,
  renderCapturedPrompt,
} from "./interaction-processing-support.ts";

registerCliNameIsolation();

describe("processChannelInteraction follow-up route modes", () => {
  test("updates mention-only for the current conversation via /mention", async () => {
    const posted: string[] = [];
    let setModeCalls = 0;
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
        setConversationFollowUpMode: async (_target: AgentSessionTarget, mode: string) => {
          setModeCalls += 1;
          expect(mode).toBe("mention-only");
        },
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/mention",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(setModeCalls).toBe(1);
    expect(replyCalls).toBe(1);
    expect(posted[0]).toContain("Follow-up mode set to `mention-only` for this conversation.");
  });

  test("updates mention-only for the current Slack channel via /mention channel", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());
    let setModeCalls = 0;

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                followUp: {
                  ...template.bots.slack.default.followUp,
                  mode: "auto",
                },
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    followUp: {
                      mode: "auto",
                    },
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async (_target: AgentSessionTarget, mode: string) => {
            setModeCalls += 1;
            expect(mode).toBe("mention-only");
          },
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/mention channel",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.slack.default.groups.C123.followUp.mode).toBe("mention-only");
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(setModeCalls).toBe(1);
    expect(posted[0]).toContain("Updated follow-up mode for `slack group:C123`.");
    expect(posted[0]).toContain("config.followUp.mode: `mention-only`");
    expect(posted[0]).toContain("currentConversation.overrideMode: `mention-only`");
  });

  test("updates mention-only for the current Telegram group via /mention channel from a topic", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            telegram: {
              ...template.bots.telegram,
              default: {
                ...template.bots.telegram.default,
                followUp: {
                  ...template.bots.telegram.default.followUp,
                  mode: "auto",
                },
                groups: {
                  "-1001": {
                    requireMention: true,
                    allowUsers: [],
                    blockUsers: [],
                    topics: {
                      "4": {
                        enabled: true,
                        allowUsers: [],
                        blockUsers: [],
                      },
                    },
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async () => undefined,
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/mention channel",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.telegram.default.groups["-1001"].followUp.mode).toBe("mention-only");
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].followUp).toBeUndefined();
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated follow-up mode for `telegram group:-1001`.");
  });

  test("updates mention-only for the current bot via /mention all", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                followUp: {
                  ...template.bots.slack.default.followUp,
                  mode: "auto",
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async () => undefined,
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/mention all",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.slack.default.followUp.mode).toBe("mention-only");
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated follow-up mode for `slack bot default`.");
    expect(posted[0]).toContain("bot-wide default");
  });
});

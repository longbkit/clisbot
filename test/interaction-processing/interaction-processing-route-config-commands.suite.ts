import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processChannelInteraction } from "../../src/channels/message/interaction-processing.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import {
  createIdentity,
  createRoute,
  registerCliNameIsolation,
  createTarget,
  createTelegramTopicIdentity,
  createTelegramTopicTarget,
} from "./interaction-processing-support.ts";

registerCliNameIsolation();

describe("processChannelInteraction route config commands", () => {
  test("shows persisted streaming mode for the current route", async () => {
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
                groups: {
                  C123: {
                    requireMention: true,
                    streaming: "all",
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/streaming status",
        route: createRoute({
          streaming: "latest",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Streaming mode: `latest`");
    expect(posted[0]).toContain("config.target: `slack group:C123`");
    expect(posted[0]).not.toContain("activeRoute.streaming:");
    expect(posted[0]).not.toContain("config.streaming:");
  });

  test("updates persisted streaming mode for the current route", async () => {
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
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    streaming: "off",
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/streaming on",
        route: createRoute({
          streaming: "off",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated streaming mode");
    expect(posted[0]).toContain("config.streaming: `all`");
    expect(posted[0]).toContain("persists as `all`");
  });

  test("shows persisted streaming mode for a telegram topic that inherits from its group route", async () => {
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
                groups: {
                  "-1001": {
                    requireMention: false,
                    allowBots: true,
                    streaming: "all",
                    topics: {},
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/streaming status",
        route: createRoute({
          streaming: "all",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Streaming mode: `all`");
    expect(posted[0]).toContain("config.target: `telegram topic:-1001:4`");
  });

  test("updates persisted streaming mode for a telegram topic by materializing a topic override", async () => {
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
                groups: {
                  "-1001": {
                    requireMention: false,
                    allowBots: true,
                    streaming: "all",
                    topics: {},
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/streaming off",
        route: createRoute({
          streaming: "all",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].streaming).toBe("off");
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].requireMention).toBe(false);
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].allowBots).toBe(true);
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated streaming mode");
    expect(posted[0]).toContain("`telegram topic:-1001:4`");
  });

  test("updates persisted response mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...JSON.parse(renderDefaultConfigTemplate()),
          bots: {
            ...JSON.parse(renderDefaultConfigTemplate()).bots,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).bots.slack,
              default: {
                ...JSON.parse(renderDefaultConfigTemplate()).bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    responseMode: "message-tool",
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/responsemode capture-pane",
        route: createRoute({
          responseMode: "message-tool",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated response mode");
    expect(posted[0]).toContain("config.responseMode: `capture-pane`");
  });

  test("shows persisted additional message mode for the current route", async () => {
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
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    additionalMessageMode: "queue",
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/additionalmessagemode status",
        route: createRoute({
          additionalMessageMode: "queue",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Additional message mode");
    expect(posted[0]).toContain("activeRoute.additionalMessageMode: `queue`");
    expect(posted[0]).toContain("config.additionalMessageMode: `queue`");
  });

  test("updates persisted additional message mode for the current route", async () => {
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
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    additionalMessageMode: "steer",
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
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/additionalmessagemode queue",
        route: createRoute({
          additionalMessageMode: "steer",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated additional message mode");
    expect(posted[0]).toContain("config.additionalMessageMode: `queue`");
  });

  test("passes the protected control rule into created loops", async () => {
    const posted: string[] = [];
    let observedProtectedRule: string | undefined;

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        createIntervalLoop: async (params: { protectedControlMutationRule?: string }) => {
          observedProtectedRule = params.protectedControlMutationRule;
          return {
            id: "loop1",
            maxRuns: 20,
          };
        },
        listIntervalLoops: () => [],
        getActiveIntervalLoopCount: () => 1,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 5m review the queue",
      protectedControlMutationRule: "Refuse protected control changes.",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedProtectedRule).toBe("Refuse protected control changes.");
    expect(posted[0]).toContain("Started loop");
  });
});

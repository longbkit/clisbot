import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPairingCli } from "../src/channels/pairing/cli.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import {
  listChannelPairingRequests,
  upsertChannelPairingRequest,
} from "../src/channels/pairing/store.ts";

let previousCliName: string | undefined;
let previousConfigPath: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
  process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
});

function withPairingDir(
  tempDir: string,
  callback: () => Promise<void>,
) {
  const previousDir = process.env.CLISBOT_PAIRING_DIR;
  process.env.CLISBOT_PAIRING_DIR = tempDir;
  return callback().finally(() => {
    if (previousDir == null) {
      delete process.env.CLISBOT_PAIRING_DIR;
    } else {
      process.env.CLISBOT_PAIRING_DIR = previousDir;
    }
  });
}

async function seedConfig(configPath: string) {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
      }),
    ),
  );
  config.agents.list = [{ id: "default" }];
  await writeEditableConfig(configPath, config);
}

describe("pairing cli", () => {
  test("prints help for explicit help alias", async () => {
    const lines: string[] = [];
    await runPairingCli(["help"], {
      log: (line) => lines.push(line),
    });

    const text = lines.join("\n");
    expect(text).toContain("clisbot pairing");
    expect(text).toContain("clisbot pairing help");
    expect(text).toContain("clisbot pairing clear <slack|telegram>");
  });

  test("lists pending requests as text", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      await withPairingDir(tempDir, async () => {
        await runPairingCli(["list", "slack"], {
          log: (line) => lines.push(line),
        });
      });

      expect(lines.join("\n")).toContain("Pending slack pairing requests:");
      expect(lines.join("\n")).toContain("id=U123");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("approves a pending code", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
      process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
      await seedConfig(process.env.CLISBOT_CONFIG_PATH);
      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        botId: "default",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      await withPairingDir(tempDir, async () => {
        await runPairingCli(["approve", "telegram", created.code], {
          log: (line) => lines.push(line),
        });
      });

      expect(lines.join("\n")).toContain("Approved telegram sender 123456 for bot default.");
      const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
      expect(rawConfig.bots.telegram.default.directMessages["dm:*"].allowUsers).toEqual(["123456"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("approval is scoped to the requesting bot", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
      process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
      await seedConfig(process.env.CLISBOT_CONFIG_PATH);

      const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
      rawConfig.bots.telegram.support = {
        ...rawConfig.bots.telegram.default,
        name: "support",
        botToken: "${TELEGRAM_SUPPORT_BOT_TOKEN}",
        directMessages: {},
      };
      await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, rawConfig);

      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        botId: "support",
        baseDir: tempDir,
      });

      await withPairingDir(tempDir, async () => {
        await runPairingCli(["approve", "telegram", created.code], {
          log: () => {},
        });
      });

      const updatedConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
      expect(updatedConfig.bots.telegram.support.directMessages["dm:*"].allowUsers).toEqual(["123456"]);
      expect(updatedConfig.bots.telegram.default.directMessages["dm:*"]).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects a pending code", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      await withPairingDir(tempDir, async () => {
        await runPairingCli(["reject", "slack", created.code], {
          log: (line) => lines.push(line),
        });
      });

      expect(lines.join("\n")).toContain("Rejected slack sender U123.");
      expect(await listChannelPairingRequests("slack", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("clears all pending requests for one channel", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        baseDir: tempDir,
      });
      await upsertChannelPairingRequest({
        channel: "telegram",
        id: "789012",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      await withPairingDir(tempDir, async () => {
        await runPairingCli(["clear", "telegram"], {
          log: (line) => lines.push(line),
        });
      });

      expect(lines.join("\n")).toContain("Cleared 2 pending telegram pairing request(s).");
      expect(await listChannelPairingRequests("telegram", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("still accepts the legacy pairing dir env as a fallback", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-cli-"));
    try {
      await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      const previousClisbotDir = process.env.CLISBOT_PAIRING_DIR;
      const previousLegacyDir = process.env.TMUX_TALK_PAIRING_DIR;
      delete process.env.CLISBOT_PAIRING_DIR;
      process.env.TMUX_TALK_PAIRING_DIR = tempDir;
      try {
        await runPairingCli(["list", "slack"], {
          log: (line) => lines.push(line),
        });
      } finally {
        if (previousClisbotDir == null) {
          delete process.env.CLISBOT_PAIRING_DIR;
        } else {
          process.env.CLISBOT_PAIRING_DIR = previousClisbotDir;
        }
        if (previousLegacyDir == null) {
          delete process.env.TMUX_TALK_PAIRING_DIR;
        } else {
          process.env.TMUX_TALK_PAIRING_DIR = previousLegacyDir;
        }
      }

      expect(lines.join("\n")).toContain("id=U123");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

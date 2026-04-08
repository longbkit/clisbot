import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPairingCli } from "../src/channels/pairing/cli.ts";
import { upsertChannelPairingRequest } from "../src/channels/pairing/store.ts";

describe("pairing cli", () => {
  test("lists pending requests as text", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-pairing-cli-"));
    try {
      await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      const previousDir = process.env.TMUX_TALK_PAIRING_DIR;
      process.env.TMUX_TALK_PAIRING_DIR = tempDir;
      try {
        await runPairingCli(["list", "slack"], {
          log: (line) => lines.push(line),
        });
      } finally {
        if (previousDir == null) {
          delete process.env.TMUX_TALK_PAIRING_DIR;
        } else {
          process.env.TMUX_TALK_PAIRING_DIR = previousDir;
        }
      }
      expect(lines.join("\n")).toContain("Pending slack pairing requests:");
      expect(lines.join("\n")).toContain("id=U123");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("approves a pending code", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-pairing-cli-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        baseDir: tempDir,
      });

      const lines: string[] = [];
      const previousDir = process.env.TMUX_TALK_PAIRING_DIR;
      process.env.TMUX_TALK_PAIRING_DIR = tempDir;
      try {
        await runPairingCli(["approve", "telegram", created.code], {
          log: (line) => lines.push(line),
        });
      } finally {
        if (previousDir == null) {
          delete process.env.TMUX_TALK_PAIRING_DIR;
        } else {
          process.env.TMUX_TALK_PAIRING_DIR = previousDir;
        }
      }

      expect(lines.join("\n")).toContain("Approved telegram sender 123456.");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveChannelPairingCode,
  clearChannelPairingRequests,
  listChannelPairingRequests,
  rejectChannelPairingCode,
  upsertChannelPairingRequest,
} from "../src/channels/pairing/store.ts";

describe("pairing store", () => {
  test("reuses a pending code for the same sender", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      const first = await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });
      const second = await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.code).toBe(first.code);
      expect((await listChannelPairingRequests("slack", tempDir)).length).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("approving a code removes the pending request and preserves the requesting bot id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        botId: "alerts",
        baseDir: tempDir,
      });
      const approved = await approveChannelPairingCode({
        channel: "telegram",
        code: created.code,
        baseDir: tempDir,
      });

      expect(approved?.id).toBe("123456");
      expect(approved?.botId).toBe("alerts");
      expect(await listChannelPairingRequests("telegram", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("expires stale pending requests on read", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        baseDir: tempDir,
      });
      expect(created.created).toBe(true);

      const filePath = join(tempDir, "telegram-pairing.json");
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
        requests: Array<Record<string, unknown>>;
      };
      const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await Bun.write(
        filePath,
        JSON.stringify(
          {
            version: 1,
            requests: parsed.requests.map((request) => ({
              ...request,
              createdAt: expiredAt,
              lastSeenAt: expiredAt,
            })),
          },
          null,
          2,
        ),
      );

      expect(await listChannelPairingRequests("telegram", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejecting a code removes the pending request without allowlisting the sender", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "slack",
        id: "U123",
        baseDir: tempDir,
      });
      const rejected = await rejectChannelPairingCode({
        channel: "slack",
        code: created.code,
        baseDir: tempDir,
      });

      expect(rejected?.id).toBe("U123");
      expect(await listChannelPairingRequests("slack", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("clear removes every pending pairing request for one channel", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      await upsertChannelPairingRequest({
        channel: "telegram",
        id: "1001",
        baseDir: tempDir,
      });
      await upsertChannelPairingRequest({
        channel: "telegram",
        id: "1002",
        baseDir: tempDir,
      });

      const cleared = await clearChannelPairingRequests({
        channel: "telegram",
        baseDir: tempDir,
      });

      expect(cleared.cleared).toBe(2);
      expect(await listChannelPairingRequests("telegram", tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("keeps up to twenty pending requests per channel", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-pairing-"));
    try {
      for (let index = 1; index <= 20; index += 1) {
        const created = await upsertChannelPairingRequest({
          channel: "slack",
          id: `U${index}`,
          baseDir: tempDir,
        });
        expect(created.code).not.toBe("");
      }

      const overflow = await upsertChannelPairingRequest({
        channel: "slack",
        id: "U21",
        baseDir: tempDir,
      });

      expect(overflow.code).toBe("");
      expect(await listChannelPairingRequests("slack", tempDir)).toHaveLength(20);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../src/channels/pairing/store.ts";

describe("pairing store", () => {
  test("reuses a pending code for the same sender", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-pairing-"));
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

  test("approving a code removes the pending request and populates allowFrom", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-pairing-"));
    try {
      const created = await upsertChannelPairingRequest({
        channel: "telegram",
        id: "123456",
        baseDir: tempDir,
      });
      const approved = await approveChannelPairingCode({
        channel: "telegram",
        code: created.code,
        baseDir: tempDir,
      });

      expect(approved?.id).toBe("123456");
      expect(await listChannelPairingRequests("telegram", tempDir)).toEqual([]);
      expect(await readChannelAllowFromStore("telegram", tempDir)).toEqual(["123456"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("expires stale pending requests on read", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-pairing-"));
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
});

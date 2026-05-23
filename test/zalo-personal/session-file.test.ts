import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeZaloPersonalAuthSession,
  readZaloPersonalAuthSession,
  removeZaloPersonalAuthSession,
  writeZaloPersonalAuthSession,
  type ZaloPersonalAuthSession,
} from "../../src/channels/zalo-personal/session-file.ts";

function buildSession(): ZaloPersonalAuthSession {
  return {
    version: 1,
    cookie: [{ name: "zpsid", value: "cookie" }],
    imei: "imei-1",
    userAgent: "test-agent",
    language: "vi",
    savedAt: "2026-05-17T00:00:00.000Z",
    user: { name: "Long" },
  };
}

describe("zalo-personal session file", () => {
  test("writes opaque auth session files with owner-only permissions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-session-"));
    const tokenFile = join(tempDir, "credentials", "zalo-personal", "default", "auth-session");
    try {
      await writeZaloPersonalAuthSession(tokenFile, buildSession());

      const parsed = await readZaloPersonalAuthSession(tokenFile);
      expect(parsed?.cookie).toEqual([{ name: "zpsid", value: "cookie" }]);
      expect(parsed?.imei).toBe("imei-1");
      expect(parsed?.userAgent).toBe("test-agent");
      expect(parsed?.language).toBe("vi");
      expect(JSON.parse(readFileSync(tokenFile, "utf8")).cookie).toBeArray();
      expect((statSync(tokenFile).mode & 0o777).toString(8)).toBe("600");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("describes missing and present session files without leaking cookie content", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-session-"));
    const tokenFile = join(tempDir, "auth-session");
    try {
      expect(await describeZaloPersonalAuthSession(tokenFile)).toEqual({
        loggedIn: false,
        detail: `missing path=${tokenFile}`,
      });

      await writeZaloPersonalAuthSession(tokenFile, buildSession());
      const present = await describeZaloPersonalAuthSession(tokenFile);
      expect(present.loggedIn).toBe(true);
      expect(present.detail).toContain("present path=");
      expect(present.detail).toContain("savedAt=2026-05-17T00:00:00.000Z");
      expect(present.detail).not.toContain("cookie");

      await removeZaloPersonalAuthSession(tokenFile);
      expect((await describeZaloPersonalAuthSession(tokenFile)).loggedIn).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects invalid auth session files before use", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-session-"));
    const tokenFile = join(tempDir, "auth-session");
    try {
      await Bun.write(tokenFile, JSON.stringify({ version: 1, cookie: [] }));
      await expect(readZaloPersonalAuthSession(tokenFile)).rejects.toThrow(
        "missing imei",
      );
      const status = await describeZaloPersonalAuthSession(tokenFile);
      expect(status.loggedIn).toBe(false);
      expect(status.detail).toContain("invalid path=");
      expect(status.detail).toContain("missing imei");
      expect(status.detail).not.toContain("cookie");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

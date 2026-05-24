import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const LoginQRCallbackEventType = {
  QRCodeGenerated: "QRCodeGenerated",
  QRCodeScanned: "QRCodeScanned",
  QRCodeDeclined: "QRCodeDeclined",
  QRCodeExpired: "QRCodeExpired",
  GotLoginInfo: "GotLoginInfo",
};

mock.module("zca-js", () => ({
  LoginQRCallbackEventType,
  ThreadType: { User: 0, Group: 1 },
  Zalo: class {
    async login(credentials: { userAgent: string; language?: string }) {
      return {
        getContext: () => ({
          imei: "imei-refreshed",
          userAgent: credentials.userAgent,
          language: credentials.language,
        }),
        getCookie: () => ({
          toJSON: () => ({ cookies: [{ name: "zpsid", value: "cookie-refreshed" }] }),
        }),
      };
    }

    async loginQR(options: { userAgent: string; language?: string; qrPath?: string }, callback: (event: any) => void) {
      callback({
        type: LoginQRCallbackEventType.QRCodeGenerated,
        data: { code: "not-a-login-qr", image: buildQrPngBase64() },
        actions: {
          saveToFile: async () => {
            throw new Error("disk denied");
          },
        },
      });
      if (!options.qrPath?.includes("fallback")) {
        callback({
          type: LoginQRCallbackEventType.GotLoginInfo,
          data: {
            cookie: [{ name: "zpsid", value: "cookie" }],
            imei: "imei-1",
            userAgent: options.userAgent,
          },
        });
      }
      return {
        sendMessage: async () => ({ ok: true }),
        getContext: () => ({
          imei: "imei-from-api",
          userAgent: options.userAgent,
          language: options.language,
        }),
        getCookie: () => ({
          toJSON: () => ({ cookies: [{ name: "zpsid", value: "cookie-from-api" }] }),
        }),
      };
    }
  },
}));

describe("zalo-personal zca-js wrapper", () => {
  test("prints console QR and completes login when QR file save fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-qr-"));
    const tokenFile = join(tempDir, "auth-session");
    const logs: string[] = [];
    try {
      const { loginZaloPersonalWithQr } = await import("../../src/channels/zalo-personal/zca-js.ts");
      await loginZaloPersonalWithQr({
        tokenFile,
        qrPath: join(tempDir, "qr.png"),
        logger: { log: (message) => logs.push(message) },
      });

      expect(logs.some((line) => line.includes("Zalo Personal QR login only"))).toBe(true);
      expect(logs.some((line) => line.includes("\x1b["))).toBe(true);
      expect(maxVisibleQrLineWidth(logs)).toBeLessThanOrEqual(50);
      expect(logs.some((line) => line.includes("not-a-login-qr"))).toBe(false);
      expect(logs.some((line) => line.includes("QR save failed"))).toBe(true);
      const session = JSON.parse(readFileSync(tokenFile, "utf8"));
      expect(session.cookie).toEqual([{ name: "zpsid", value: "cookie" }]);
      expect(session.imei).toBe("imei-1");
      expect(session.language).toBe("vi");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to api context when QR callback omits reusable login info", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-qr-"));
    const tokenFile = join(tempDir, "auth-session");
    try {
      const { loginZaloPersonalWithQr } = await import("../../src/channels/zalo-personal/zca-js.ts");
      await loginZaloPersonalWithQr({
        tokenFile,
        qrPath: join(tempDir, "fallback-qr.png"),
        logger: { log: () => undefined },
      });

      const session = JSON.parse(readFileSync(tokenFile, "utf8"));
      expect(session.cookie).toEqual([{ name: "zpsid", value: "cookie-from-api" }]);
      expect(session.imei).toBe("imei-from-api");
      expect(session.language).toBe("vi");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("refreshes the stored session after session login succeeds", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-session-login-"));
    const tokenFile = join(tempDir, "auth-session");
    try {
      await Bun.write(tokenFile, JSON.stringify({
        version: 1,
        cookie: [{ name: "zpsid", value: "old-cookie" }],
        imei: "old-imei",
        userAgent: "test-agent",
        language: "vi",
        savedAt: "2026-05-17T00:00:00.000Z",
        user: { name: "Long" },
      }));

      const { loginZaloPersonalFromSession } = await import("../../src/channels/zalo-personal/zca-js.ts");
      await loginZaloPersonalFromSession(tokenFile);

      const session = JSON.parse(readFileSync(tokenFile, "utf8"));
      expect(session.cookie).toEqual([{ name: "zpsid", value: "cookie-refreshed" }]);
      expect(session.imei).toBe("imei-refreshed");
      expect(session.user).toEqual({ name: "Long" });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function buildQrPngBase64() {
  const moduleCount = 41;
  const moduleSize = 9;
  const quietPx = 15;
  const png = new PNG({
    width: moduleCount * moduleSize + quietPx * 2,
    height: moduleCount * moduleSize + quietPx * 2,
  });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (png.width * y + x) << 2;
      const moduleX = Math.floor((x - quietPx) / moduleSize);
      const moduleY = Math.floor((y - quietPx) / moduleSize);
      const inQr = moduleX >= 0 && moduleY >= 0 && moduleX < moduleCount && moduleY < moduleCount;
      const dark = inQr && (
        moduleX === 0 ||
        moduleY === 0 ||
        moduleX === moduleCount - 1 ||
        moduleY === moduleCount - 1 ||
        (moduleX + moduleY) % 3 === 0
      );
      const value = dark ? 0 : 255;
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString("base64");
}

function maxVisibleQrLineWidth(logs: string[]) {
  return Math.max(
    ...logs.flatMap((entry) =>
      entry.split("\n")
        .filter((line) => line.includes("\x1b["))
        .map((line) => line.replace(/\x1b\[[0-9;]+m/g, "").length)
    ),
  );
}

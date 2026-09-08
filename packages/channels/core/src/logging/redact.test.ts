// Slice 25 (security): regression cover for the credential shapes that
// actually reach Fusion log lines and error messages. `redact.ts` is
// fusion-owned (D-CORE-002), so it is the one place these patterns live.

import { describe, expect, it } from "vitest";
import { formatErrorMessage } from "../infra/errors.js";
import { isSensitiveFieldKey, redactSensitiveFieldValue, redactSensitiveText } from "./redact.js";

const TELEGRAM_TOKEN = "123456789:AAHkq3nP-fake_token_for_tests_only_00";

describe("redactSensitiveText", () => {
  it("masks a Telegram bot token in a Bot API URL path", () => {
    const masked = redactSensitiveText(`GET https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile`);
    expect(masked).not.toContain(TELEGRAM_TOKEN);
    expect(masked).toContain("[redacted]");
  });

  it("masks a Telegram token whose colon is percent-encoded", () => {
    // The Fusion media transport builds its URLs with `encodeURIComponent`, so
    // this is the spelling a real `Failed to parse URL from …` carries. The
    // literal-colon pattern alone walked straight past it.
    const encoded = encodeURIComponent(TELEGRAM_TOKEN);
    const masked = redactSensitiveText(
      `TypeError: Failed to parse URL from https://api.telegram.org/file/bot${encoded}/photos/f.jpg`,
    );
    expect(masked).not.toContain(encoded);
    expect(masked).not.toContain("AAHkq3nP-fake_token_for_tests_only_00");
  });

  it("masks Slack tokens and bearer credentials but keeps the scheme word", () => {
    const masked = redactSensitiveText(
      "auth failed for xoxb-1111-2222-abcdefghijkl with Authorization: Bearer xyz0123456789abcdef",
    );
    expect(masked).not.toContain("xoxb-1111-2222-abcdefghijkl");
    expect(masked).not.toContain("xyz0123456789abcdef");
    expect(masked).toContain("Bearer [redacted]");
  });

  it("masks sensitive query parameters", () => {
    expect(redactSensitiveText("https://h.invalid/x?secret=hunter2&ok=1")).toBe(
      "https://h.invalid/x?secret=[redacted]&ok=1",
    );
  });

  it("masks the credentials the newer verticals carry", () => {
    // Discord's scheme word is `Bot`, which the bearer pattern never matched.
    const discord = redactSensitiveText("authorization: Bot MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.fghij");
    expect(discord).toBe("authorization: Bot [redacted]");
    // Zalo carries its token as a PATH segment, not a query parameter.
    const zalo = redactSensitiveText("POST https://bot-api.zapps.vn/bot1234567890:AbCdEfGhIj/getMe");
    expect(zalo).not.toContain("AbCdEfGhIj");
    // Feishu app credentials.
    expect(redactSensitiveText("app_id cli_a1b2c3d4e5f6g7h8 failed")).not.toContain(
      "cli_a1b2c3d4e5f6g7h8",
    );
    // A Google Chat service-account private key.
    const pem = redactSensitiveText(
      "key: -----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----",
    );
    expect(pem).toBe("key: [redacted]");
  });
});

describe("formatErrorMessage", () => {
  it("is the redacting stringifier the transports must use for fetch faults", () => {
    const encoded = encodeURIComponent(TELEGRAM_TOKEN);
    const message = formatErrorMessage(
      new Error(`fetch failed: https://api.telegram.org/file/bot${encoded}/f.jpg`),
    );
    expect(message).not.toContain(encoded);
  });
});

describe("redactSensitiveFieldValue", () => {
  it("masks a whole value under a credential-bearing key", () => {
    expect(isSensitiveFieldKey("token")).toBe(true);
    // The verticals' own credential field names, which the carried key set did
    // not cover before slice 25.
    expect(isSensitiveFieldKey("botToken")).toBe(true);
    expect(isSensitiveFieldKey("encryptKey")).toBe(true);
    expect(isSensitiveFieldKey("imei")).toBe(true);
    expect(redactSensitiveFieldValue("token", "anything at all")).toBe("[redacted]");
  });

  it("falls back to the text redactor under an ordinary key", () => {
    expect(
      redactSensitiveFieldValue("detail", `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`),
    ).not.toContain(TELEGRAM_TOKEN);
  });
});

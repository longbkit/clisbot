// COMPAT(clisbot-control-plane): targeted tests for the shared outbound-media
// policy — G11 caps + notice wording, and the mime/extension table. The gate
// is size-only: both channels post arbitrary files, so unknown extensions
// must pass.

import { describe, expect, it } from "vitest";
import {
  evaluateOutboundMedia,
  mediaFileName,
  mediaMaxBytesForChannel,
  mediaNotice,
  mimeFromExtension,
  SLACK_MAX_MEDIA_BYTES,
  TELEGRAM_MAX_MEDIA_BYTES,
} from "./media-policy.js";

describe("G11 caps", () => {
  it("exposes the pinned per-channel caps", () => {
    expect(TELEGRAM_MAX_MEDIA_BYTES).toBe(50 * 1024 * 1024);
    expect(SLACK_MAX_MEDIA_BYTES).toBe(250 * 1024 * 1024);
    expect(mediaMaxBytesForChannel("telegram")).toBe(50 * 1024 * 1024);
    expect(mediaMaxBytesForChannel("slack")).toBe(250 * 1024 * 1024);
  });
});

describe("evaluateOutboundMedia", () => {
  it("passes a small file of any mime (the gate is size-only)", () => {
    for (const fileName of ["a.png", "notes.md", "config.json", "script.ts", "blob.zip"]) {
      expect(evaluateOutboundMedia({ sizeBytes: 100, channel: "telegram", fileName })).toEqual({
        ok: true,
      });
      expect(evaluateOutboundMedia({ sizeBytes: 100, channel: "slack", fileName })).toEqual({
        ok: true,
      });
    }
  });
  it("flags a Telegram-oversized file with the G11 notice", () => {
    const d = evaluateOutboundMedia({
      sizeBytes: TELEGRAM_MAX_MEDIA_BYTES + 1,
      channel: "telegram",
      fileName: "big.png",
    });
    expect(d).toEqual({
      ok: false,
      reason: "too-large",
      notice: "Could not post media big.png: too large (Telegram limit 50 MB)",
    });
  });
  it("flags a Slack-oversized file with the G11 notice", () => {
    const d = evaluateOutboundMedia({
      sizeBytes: SLACK_MAX_MEDIA_BYTES + 1,
      channel: "slack",
      fileName: "big.png",
    });
    expect(d).toEqual({
      ok: false,
      reason: "too-large",
      notice: "Could not post media big.png: too large (Slack limit 250 MB)",
    });
  });
});

describe("mediaNotice", () => {
  it("reproduces the pinned G11 wording", () => {
    expect(mediaNotice("telegram", "x.jpg")).toBe(
      "Could not post media x.jpg: too large (Telegram limit 50 MB)",
    );
    expect(mediaNotice("slack", "x.jpg")).toBe(
      "Could not post media x.jpg: too large (Slack limit 250 MB)",
    );
  });
});

describe("mimeFromExtension", () => {
  it("maps the supported media extensions to mimes", () => {
    expect(mimeFromExtension(".png")).toBe("image/png");
    expect(mimeFromExtension(".MP4")).toBe("video/mp4");
    expect(mimeFromExtension(".mp3")).toBe("audio/mpeg");
    expect(mimeFromExtension(".pdf")).toBe("application/pdf");
    expect(mimeFromExtension(".zip")).toBeUndefined();
  });
});

describe("mediaFileName", () => {
  it("returns the base name", () => {
    expect(mediaFileName("/home/u/repo/out/pic.png")).toBe("pic.png");
  });
});

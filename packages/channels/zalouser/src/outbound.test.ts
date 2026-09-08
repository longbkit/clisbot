// The Hub drive surface (D-ZU-018): `outbound.sendText` / `sendMedia` onto the
// carried send path — target normalization, markdown text mode, chunking, and
// the native upload the personal-account client (unlike the Zalo Bot API) has.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./channel.runtime.js", () => ({
  sendMessageZalouser: vi.fn(),
  sendReactionZalouser: vi.fn(),
  probeZalouser: vi.fn(),
  listZaloFriendsMatching: vi.fn(),
  listZaloGroupMembers: vi.fn(),
  listZaloGroupsMatching: vi.fn(),
  logoutZaloProfile: vi.fn(),
  startZaloQrLogin: vi.fn(),
  waitForZaloQrLogin: vi.fn(),
  getZaloUserInfo: vi.fn(),
}));

import { sendMessageZalouser } from "./channel.runtime.js";
import { sendMedia, sendText, ZALOUSER_TEXT_CHUNK_LIMIT } from "./outbound.js";
import type { OpenClawConfig } from "./runtime-api.js";

const sendMock = vi.mocked(sendMessageZalouser);

const cfg = {
  channels: { zalouser: { enabled: true, accounts: { default: { profile: "default" } } } },
} as unknown as OpenClawConfig;

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({
    ok: true,
    messageId: "sent-1",
    receipt: { platformMessageIds: ["sent-1"], parts: [], kind: "text" },
  } as never);
});

describe("sendText", () => {
  it("posts a group target as markdown at upstream's chunk limit", async () => {
    const result = await sendText({
      cfg,
      accountId: "default",
      to: "zalouser:group:g1",
      text: "hello **world**",
    });

    expect(result.messageId).toBe("sent-1");
    expect(sendMock).toHaveBeenCalledWith(
      "g1",
      "hello **world**",
      expect.objectContaining({
        profile: "default",
        isGroup: true,
        textMode: "markdown",
        textChunkLimit: ZALOUSER_TEXT_CHUNK_LIMIT,
      }),
    );
  });

  it("posts a bare id as a direct thread", async () => {
    await sendText({ cfg, accountId: "default", to: "42", text: "hi" });
    expect(sendMock).toHaveBeenCalledWith("42", "hi", expect.objectContaining({ isGroup: false }));
  });

  it("takes the profile from the drive-time account carrier", async () => {
    await sendText({
      cfg,
      accountId: "default",
      to: "user:42",
      text: "hi",
      account: { profile: "from-connection" },
    });
    expect(sendMock).toHaveBeenCalledWith(
      "42",
      "hi",
      expect.objectContaining({ profile: "from-connection" }),
    );
  });

  it("honours an account-level chunk limit and mode", async () => {
    // The compiled account entry carries the two knobs (D-ZU-010).
    const withKnobs = {
      channels: {
        zalouser: {
          enabled: true,
          accounts: { default: { profile: "default", textChunkLimit: 500, textChunkMode: "newline" } },
        },
      },
    } as unknown as OpenClawConfig;
    await sendText({ cfg: withKnobs, accountId: "default", to: "user:42", text: "hi" });
    expect(sendMock).toHaveBeenLastCalledWith(
      "42",
      "hi",
      expect.objectContaining({ textChunkLimit: 500, textChunkMode: "newline" }),
    );
  });

  it("throws when the send produced no message id", async () => {
    sendMock.mockResolvedValueOnce({ ok: true, receipt: { platformMessageIds: [] } } as never);
    await expect(sendText({ cfg, accountId: "default", to: "user:42", text: "hi" })).rejects.toThrow(
      /produced no message/,
    );
  });
});

describe("sendMedia", () => {
  it("uploads the local file natively and reports mediaPosted", async () => {
    sendMock.mockResolvedValueOnce({
      ok: true,
      messageId: "media-1",
      receipt: { platformMessageIds: ["media-1"], parts: [], kind: "media" },
    } as never);

    const result = await sendMedia({
      cfg,
      accountId: "default",
      to: "user:42",
      filePath: "/tmp/agent-home/report.pdf",
      text: "here",
    });

    expect(result).toMatchObject({ messageId: "media-1", mediaPosted: true });
    expect(sendMock).toHaveBeenCalledWith(
      "42",
      "here",
      expect.objectContaining({
        mediaUrl: "/tmp/agent-home/report.pdf",
        // The loader may only read from the file's own directory.
        mediaLocalRoots: ["/tmp/agent-home"],
      }),
    );
  });
});

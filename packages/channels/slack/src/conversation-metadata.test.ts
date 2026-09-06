import { beforeEach, expect, it, vi } from "vitest";
import { createSlackWebClient } from "./client/web-api.js";
import { resolveSlackConversation } from "./conversation-metadata.js";
vi.mock("./client/web-api.js", () => ({ createSlackWebClient: vi.fn() }));
const info = vi.fn();
beforeEach(() => {
  vi.mocked(createSlackWebClient).mockResolvedValue({ conversations: { info } } as never);
  info.mockReset();
});
const args = {
  cfg: { channels: { slack: { accounts: { work: { botToken: "test-token" } } } } },
  accountId: "work",
  to: "C123",
};
it("reads only one configured channel using its bot token and returns only safe metadata", async () => {
  info.mockResolvedValue({
    ok: true,
    channel: {
      id: "C123",
      name: "support",
      is_private: true,
      latest: { text: "never return message bodies" },
    },
  });
  expect(await resolveSlackConversation(args)).toEqual({
    label: "support",
    kind: "channel",
    visibility: "private",
  });
  expect(info).toHaveBeenCalledWith({ channel: "C123" });
  expect(createSlackWebClient).toHaveBeenCalledWith(
    "test-token",
    expect.objectContaining({
      timeout: 5000,
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
    }),
  );
});
it("returns no label for inaccessible or mismatched IDs", async () => {
  info.mockResolvedValue({ ok: false, error: "channel_not_found" });
  expect(await resolveSlackConversation(args)).toBeNull();
  info.mockResolvedValue({ ok: true, channel: { id: "other", name: "wrong" } });
  expect(await resolveSlackConversation(args)).toBeNull();
  info.mockResolvedValue({ ok: true, channel: { id: "C123", name: "support" } });
  expect((await resolveSlackConversation(args))?.visibility).toBe("unknown");
});

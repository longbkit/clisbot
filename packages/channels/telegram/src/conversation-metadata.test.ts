import { beforeEach, expect, it, vi } from "vitest";
import { createTelegramApi } from "./client/bot-api.js";
import { resolveTelegramConversation } from "./conversation-metadata.js";
vi.mock("./client/bot-api.js", async (original) => ({
  ...(await original<typeof import("./client/bot-api.js")>()),
  createTelegramApi: vi.fn(),
}));
const getChat = vi.fn();
beforeEach(() => {
  vi.mocked(createTelegramApi).mockResolvedValue({ getChat } as never);
  getChat.mockReset();
});
const args = {
  cfg: { channels: { telegram: { accounts: { work: { botToken: "test-token" } } } } },
  accountId: "work",
  to: "-123",
};
it("fetches the group title without claiming a forum topic name or exposing chat details", async () => {
  getChat.mockResolvedValue({
    id: -123,
    type: "supergroup",
    title: "Support forum",
    is_forum: true,
    description: "private detail",
  });
  expect(await resolveTelegramConversation(args)).toEqual({
    label: "Support forum",
    kind: "group",
    visibility: "unknown",
  });
  expect(getChat).toHaveBeenCalledWith("-123");
  // The port made the per-method table (`request-timeouts.ts`) own the request
  // bound and a configured `timeoutSeconds` only a floor over it, so the client
  // is built with the send floor (60s) and this `getChat` is bounded at the
  // table's 15s — the 5 asked for above can no longer lower either.
  expect(createTelegramApi).toHaveBeenCalledWith(
    "test-token",
    expect.objectContaining({ timeoutSeconds: 60 }),
  );
});
it("does not use a renamed alias or mismatched chat ID as another destination", async () => {
  getChat.mockResolvedValue({ id: -456, title: "Other chat" });
  expect(await resolveTelegramConversation(args)).toBeNull();
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearZaloTypingTimersForTest, ZALO_TYPING_REFRESH_MS, zaloTyping } from "./typing.js";

const cfg = { channels: { zalo: { accounts: { main: { botToken: "bot-token" } } } } };

function drive(send: ReturnType<typeof vi.fn>, action: "start" | "stop") {
  return zaloTyping({ cfg, accountId: "main", to: "chat-1", action, indicator: true, send });
}

describe("zaloTyping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearZaloTypingTimersForTest();
    vi.useRealTimers();
  });

  it("shows the action at once with the account's token, keeps it shown, and stops", async () => {
    const send = vi.fn(async () => undefined);
    await drive(send, "start");
    expect(send).toHaveBeenCalledWith("bot-token", "chat-1");
    await vi.advanceTimersByTimeAsync(ZALO_TYPING_REFRESH_MS * 2);
    expect(send).toHaveBeenCalledTimes(3);
    await drive(send, "stop");
    await vi.advanceTimersByTimeAsync(ZALO_TYPING_REFRESH_MS * 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the Route shows no indicator", async () => {
    const send = vi.fn(async () => undefined);
    await zaloTyping({ cfg, accountId: "main", to: "chat-1", action: "start", indicator: false, send });
    expect(send).not.toHaveBeenCalled();
  });

  it("stops refreshing a chat that refuses the action", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error("refused");
    });
    await drive(send, "start");
    await vi.advanceTimersByTimeAsync(ZALO_TYPING_REFRESH_MS * 4);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

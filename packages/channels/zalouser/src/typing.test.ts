import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearZalouserTypingTimersForTest,
  ZALOUSER_TYPING_REFRESH_MS,
  zalouserTyping,
} from "./typing.js";

const cfg = { channels: { zalouser: { accounts: { main: { profile: "main-profile" } } } } };

function drive(send: ReturnType<typeof vi.fn>, to: string, action: "start" | "stop") {
  return zalouserTyping({ cfg, accountId: "main", to, action, indicator: true, send });
}

describe("zalouserTyping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearZalouserTypingTimersForTest();
    vi.useRealTimers();
  });

  it("shows the event at once, keeps it shown, and lets it lapse on stop", async () => {
    const send = vi.fn(async () => undefined);
    await drive(send, "111", "start");
    expect(send).toHaveBeenCalledWith("111", { profile: "main-profile", isGroup: false });
    await vi.advanceTimersByTimeAsync(ZALOUSER_TYPING_REFRESH_MS * 2);
    expect(send).toHaveBeenCalledTimes(3);
    await drive(send, "111", "stop");
    await vi.advanceTimersByTimeAsync(ZALOUSER_TYPING_REFRESH_MS * 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("types into a group by its group: target", async () => {
    const send = vi.fn(async () => undefined);
    await drive(send, "group:g1", "start");
    expect(send).toHaveBeenCalledWith("g1", { profile: "main-profile", isGroup: true });
  });

  it("does nothing when the Route shows no indicator", async () => {
    const send = vi.fn(async () => undefined);
    await zalouserTyping({ cfg, accountId: "main", to: "111", action: "start", indicator: false, send });
    expect(send).not.toHaveBeenCalled();
  });

  it("stops refreshing a chat that refuses the event", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error("refused");
    });
    await drive(send, "111", "start");
    await vi.advanceTimersByTimeAsync(ZALOUSER_TYPING_REFRESH_MS * 4);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

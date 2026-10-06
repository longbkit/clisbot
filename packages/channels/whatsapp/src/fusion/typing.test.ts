import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWhatsAppTypingTimersForTest,
  stopWhatsAppTypingForAccount,
  WHATSAPP_TYPING_REFRESH_MS,
  whatsappTyping,
  type WhatsAppTypingArgs,
} from "./typing.js";

function args(
  action: "start" | "stop",
  overrides: Partial<WhatsAppTypingArgs> = {},
): WhatsAppTypingArgs {
  return {
    accountId: "main",
    to: "15550001111@s.whatsapp.net",
    action,
    indicator: true,
    compose: async () => undefined,
    ...overrides,
  };
}

describe("WhatsApp typing for the whole turn", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearWhatsAppTypingTimersForTest();
    vi.useRealTimers();
  });

  it("keeps showing typing until the turn stops, then clears it", async () => {
    const compose = vi.fn(async () => undefined);
    const pause = vi.fn(async () => undefined);
    await whatsappTyping(args("start", { compose, pause }));
    expect(compose).toHaveBeenCalledTimes(1);
    // A long turn: the indicator is re-sent before WhatsApp lets it lapse, and
    // after a progress message cleared it.
    await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_REFRESH_MS * 5);
    expect(compose).toHaveBeenCalledTimes(6);
    await whatsappTyping(args("stop", { compose, pause }));
    expect(pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_REFRESH_MS * 3);
    expect(compose).toHaveBeenCalledTimes(6);
  });

  it("does not keep typing when the turn stops while the first update is still sending", async () => {
    let finishSend: () => void = () => undefined;
    const compose = vi.fn(
      () => new Promise<void>((resolve) => (finishSend = resolve)),
    );
    const pause = vi.fn(async () => undefined);
    const starting = whatsappTyping(args("start", { compose, pause }));
    await whatsappTyping(args("stop", { compose, pause }));
    finishSend();
    await starting;
    await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_REFRESH_MS * 3);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("cancels an account's timers when the account stops", async () => {
    const compose = vi.fn(async () => undefined);
    await whatsappTyping(args("start", { compose }));
    stopWhatsAppTypingForAccount("main");
    await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_REFRESH_MS * 3);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("stops refreshing a chat that refuses the update", async () => {
    const compose = vi.fn(async () => undefined);
    await whatsappTyping(args("start", { compose }));
    compose.mockRejectedValue(new Error("not allowed"));
    await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_REFRESH_MS * 4);
    expect(compose).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the Route turned the indicator off, or on a stop with nothing shown", async () => {
    const compose = vi.fn(async () => undefined);
    const pause = vi.fn(async () => undefined);
    await whatsappTyping(args("start", { compose, indicator: false }));
    await whatsappTyping(args("stop", { compose, pause }));
    expect(compose).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });
});

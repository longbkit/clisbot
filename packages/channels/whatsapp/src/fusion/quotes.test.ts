import { describe, expect, it } from "vitest";
import { clearWhatsAppQuotes, noteWhatsAppInboundForQuote, takeWhatsAppQuote } from "./quotes.js";

describe("fusion quotes (the message an answer would quote)", () => {
  it("hands out the chat's latest admitted message once", () => {
    noteWhatsAppInboundForQuote({ accountId: "a", chatJid: "g@g.us", messageId: "M1" });
    noteWhatsAppInboundForQuote({ accountId: "a", chatJid: "g@g.us", messageId: "M2" });
    expect(takeWhatsAppQuote("a", "g@g.us")).toBe("M2");
    expect(takeWhatsAppQuote("a", "g@g.us")).toBeUndefined();
  });

  it("keeps chats and accounts apart, expires old quotes, clears on stop", () => {
    noteWhatsAppInboundForQuote({ accountId: "a", chatJid: "x@g.us", messageId: "X", now: 0 });
    noteWhatsAppInboundForQuote({ accountId: "b", chatJid: "x@g.us", messageId: "Y" });
    expect(takeWhatsAppQuote("a", "x@g.us", 31 * 60 * 1000)).toBeUndefined();
    clearWhatsAppQuotes("b");
    expect(takeWhatsAppQuote("b", "x@g.us")).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";

const polls = vi.hoisted(() => ({ send: vi.fn(async () => ({ messageId: "P1", toJid: "g@g.us" })) }));
vi.mock("../send.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../send.js")>()),
  sendPollWhatsApp: polls.send,
}));

const { whatsappMessageActions } = await import("./message-actions.js");

describe("whatsapp message actions", () => {
  it("advertises react and poll (files go through send)", () => {
    expect(whatsappMessageActions.describeMessageTool?.({ cfg: {}, accountId: "a" } as never)).toEqual({ actions: ["react", "poll"] });
    expect(whatsappMessageActions.supportsAction?.({ action: "poll" } as never)).toBe(true);
    expect(whatsappMessageActions.supportsAction?.({ action: "edit" } as never)).toBe(false);
  });

  it("honours upstream's reactions and polls gates", () => {
    const cfg = { channels: { whatsapp: { actions: { reactions: false, polls: false } } } };
    expect(whatsappMessageActions.describeMessageTool?.({ cfg, accountId: "a" } as never)).toEqual({ actions: [] });
  });

  it("sends a poll from core's shared poll params", async () => {
    const result = await whatsappMessageActions.handleAction?.({
      action: "poll",
      cfg: {},
      accountId: "a",
      params: { to: "g@g.us", pollQuestion: "Lunch?", pollOption: ["Pho", "Bun"], pollMulti: true },
    } as never);
    expect(polls.send).toHaveBeenCalledWith(
      "g@g.us",
      { question: "Lunch?", options: ["Pho", "Bun"], maxSelections: 2 },
      expect.objectContaining({ accountId: "a" }),
    );
    expect(JSON.stringify(result)).toContain("P1");
    await expect(
      whatsappMessageActions.handleAction?.({ action: "poll", cfg: {}, accountId: "a", params: { to: "g@g.us", pollQuestion: "Q", pollOption: ["only"] } } as never),
    ).rejects.toThrow(/two values/);
  });

  it("refuses an unsupported action instead of sending it", async () => {
    await expect(
      whatsappMessageActions.handleAction?.({ action: "upload-file", cfg: {}, accountId: "a", params: {} } as never),
    ).rejects.toThrow(/not supported/);
  });
});

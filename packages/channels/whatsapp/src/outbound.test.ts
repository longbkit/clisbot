import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as Array<{ to: string; text: string; options: Record<string, unknown> }> }));
vi.mock("./send.js", () => ({
  sendMessageWhatsApp: async (to: string, text: string, options: Record<string, unknown>) => {
    sent.calls.push({ to, text, options });
    return { messageId: "OUT1", toJid: to };
  },
  sendTypingWhatsApp: async () => {},
}));

const { sendText, sendMedia } = await import("./outbound.js");
const { createRecordingHostRuntime } = await import("./fusion/test-support.js");
const { openWhatsAppCardStore } = await import("./fusion/reaction-cards.js");
const { cacheInboundMessageMeta } = await import("./quoted-message.js");
const { noteWhatsAppInboundForQuote } = await import("./fusion/quotes.js");

const GROUP = "120363000000000002@g.us";
const cfg = (account: Record<string, unknown> = {}) => ({ channels: { whatsapp: { accounts: { acc: account } } } });

describe("outbound bridge", () => {
  beforeEach(() => {
    sent.calls.length = 0;
  });

  it("posts text and media through upstream's send path", async () => {
    await expect(sendText({ cfg: cfg(), accountId: "acc", to: GROUP, text: "hi" })).resolves.toMatchObject({ messageId: "OUT1" });
    await expect(sendMedia({ cfg: cfg(), accountId: "acc", to: GROUP, filePath: "/tmp/x/photo.jpg" })).resolves.toMatchObject({ mediaPosted: true });
    expect(sent.calls[1]?.options).toMatchObject({ mediaUrl: "/tmp/x/photo.jpg", mediaLocalRoots: ["/tmp/x"] });
    expect(sent.calls[0]?.options["quotedMessageKey"]).toBeUndefined();
  });

  it("does not quote by default (upstream replyToMode: off)", async () => {
    noteWhatsAppInboundForQuote({ accountId: "acc", chatJid: GROUP, messageId: "IN0" });
    await sendText({ cfg: cfg(), accountId: "acc", to: GROUP, text: "x" });
    expect(sent.calls[0]?.options["quotedMessageKey"]).toBeUndefined();
  });

  it("with replyToMode first, quotes the answered message once, with upstream's quote key", async () => {
    cacheInboundMessageMeta("acc", GROUP, "IN1", { participant: "15557778888@s.whatsapp.net", body: "which one?", fromMe: false });
    noteWhatsAppInboundForQuote({ accountId: "acc", chatJid: GROUP, messageId: "IN1" });
    await sendText({ cfg: cfg({ replyToMode: "first" }), accountId: "acc", to: GROUP, text: "this one" });
    expect(sent.calls[0]?.options).toMatchObject({
      replyToMode: "first",
      quotedMessageKey: { id: "IN1", remoteJid: GROUP, fromMe: false, participant: "15557778888@s.whatsapp.net", messageText: "which one?" },
    });
    await sendText({ cfg: cfg({ replyToMode: "first" }), accountId: "acc", to: GROUP, text: "and more" });
    expect(sent.calls[1]?.options["quotedMessageKey"]).toBeUndefined();
  });

  it("passes replyToMode all through to upstream's chunk fanout", async () => {
    noteWhatsAppInboundForQuote({ accountId: "acc", chatJid: GROUP, messageId: "IN2" });
    await sendText({ cfg: cfg({ replyToMode: "all" }), accountId: "acc", to: GROUP, text: "x" });
    expect(sent.calls[0]?.options).toMatchObject({ replyToMode: "all", quotedMessageKey: { id: "IN2" } });
  });

  it("sends a staged file under the name and type the agent asked for", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "wa-outbound-"));
    const staged = join(dir, "stage-7f3a.bin");
    await writeFile(staged, Buffer.from("%PDF-1.4 report"));
    await sendMedia({ cfg: cfg(), accountId: "acc", to: GROUP, filePath: staged, fileName: "Q3 report.pdf", mimeType: "application/pdf" });
    const payload = sent.calls[0]?.options["mediaPayload"] as { buffer: Buffer; fileName: string; contentType: string };
    expect(payload.fileName).toBe("Q3 report.pdf");
    expect(payload.contentType).toBe("application/pdf");
    expect(payload.buffer.toString()).toBe("%PDF-1.4 report");
    expect(sent.calls[0]?.options["mediaUrl"]).toBeUndefined();
  });

  it("quotes an explicit replyToId", async () => {
    await sendText({ cfg: cfg(), accountId: "acc", to: GROUP, text: "x", replyToId: "EXPLICIT" });
    expect(sent.calls[0]?.options).toMatchObject({ quotedMessageKey: { id: "EXPLICIT", remoteJid: GROUP }, replyToIdSource: "explicit" });
  });

  it("renders an approval card as reactions and remembers it", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const result = await sendText({
      cfg: cfg(),
      accountId: "acc",
      to: GROUP,
      text: "Approve running `rm -rf build`? Reply `approve abc`.",
      hostRuntime,
      cardButtons: [
        { text: "Approve", value: "allow:abc", style: "primary" },
        { text: "Deny", value: "deny:abc", style: "danger" },
      ],
    });
    expect(result).toMatchObject({ cardPosted: true });
    expect(sent.calls[0]?.text).toContain("Or react to this message:\n👍 Approve\n👎 Deny");
    expect(await openWhatsAppCardStore(hostRuntime).lookup("OUT1")).toEqual({
      chatJid: GROUP,
      choices: [
        { emoji: "👍", label: "Approve", value: "allow:abc" },
        { emoji: "👎", label: "Deny", value: "deny:abc" },
      ],
    });
  });

  it("forwards upstream's document and GIF options for a file", async () => {
    await sendMedia({ cfg: cfg(), accountId: "acc", to: GROUP, filePath: "/tmp/x/clip.mp4", forceDocument: true, gifPlayback: true });
    expect(sent.calls[0]?.options).toMatchObject({ forceDocument: true, gifPlayback: true });
  });
});

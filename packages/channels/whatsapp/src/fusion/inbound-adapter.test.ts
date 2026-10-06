import type { WAMessage } from "baileys";
import { describe, expect, it } from "vitest";
import type { WhatsAppEnrichedInboundMessage } from "../inbound/message-enrichment.js";
import type { WhatsAppNormalizedInboundMessage } from "../inbound/message-normalization.js";
import { buildWhatsAppInboundEvent } from "./inbound-adapter.js";

const SELF = { jid: "15550001111:7@s.whatsapp.net", lid: "999000111:7@lid", e164: "+15550001111" };
const GROUP = "120363000000000000@g.us";

function msg(id: string | undefined, extra: Partial<WAMessage> = {}): WAMessage {
  return { key: { id, remoteJid: GROUP }, pushName: "Alice", ...extra } as WAMessage;
}

function inbound(group: boolean): WhatsAppNormalizedInboundMessage {
  return {
    id: "M1",
    remoteJid: group ? GROUP : "15557778888@s.whatsapp.net",
    group,
    participantJid: group ? "15557778888@s.whatsapp.net" : undefined,
    from: group ? GROUP : "+15557778888",
    senderE164: "+15557778888",
    groupSubject: group ? "Team" : undefined,
    messageTimestampMs: 1_790_000_000_000,
    access: { allowed: true, shouldMarkRead: true, isSelfChat: false, resolvedAccountId: "a", admission: { owner: "hub" } },
  };
}

function enriched(extra: Partial<WhatsAppEnrichedInboundMessage> = {}): WhatsAppEnrichedInboundMessage {
  const body = extra.body ?? "hello";
  return { body, commandBody: extra.commandBody ?? body, ...extra };
}

describe("fusion inbound adapter", () => {
  it("maps a DM: addressed, sender as E.164, reply to the chat jid", () => {
    const build = buildWhatsAppInboundEvent({ msg: msg("M1"), inbound: inbound(false), enriched: enriched(), self: SELF });
    expect(build).toMatchObject({
      admit: true,
      event: {
        channel: "whatsapp",
        externalMessageId: "M1",
        externalEventId: "15557778888@s.whatsapp.net/M1",
        externalConversationId: "15557778888@s.whatsapp.net",
        replyTo: "15557778888@s.whatsapp.net",
        chatType: "direct",
        senderId: "+15557778888",
        senderName: "Alice",
        wasMentioned: true,
        kind: "message",
      },
    });
  });

  it("treats an unmentioned group message as not addressed and labels the room", () => {
    const build = buildWhatsAppInboundEvent({ msg: msg("M1"), inbound: inbound(true), enriched: enriched(), self: SELF });
    expect(build).toMatchObject({ admit: true, event: { chatType: "group", wasMentioned: false, conversationLabel: "Team" } });
  });

  it.each([
    ["the phone jid", "15550001111@s.whatsapp.net"],
    ["the LID", "999000111@lid"],
  ])("detects a group @mention by %s", (_label, jid) => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(true),
      enriched: enriched({ body: "@15550001111 hi", mentionedJids: [jid] }),
      self: SELF,
    });
    expect(build.admit && build.event.wasMentioned).toBe(true);
  });

  it("counts a reply to the linked account's own message as addressed", () => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(true),
      enriched: enriched({ replyContext: { body: "earlier", sender: { jid: "15550001111@s.whatsapp.net" } } }),
      self: SELF,
    });
    expect(build.admit && build.event.wasMentioned).toBe(true);
  });

  it("starts a reply with the quoted message, naming who wrote it", () => {
    const fromOther = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(true),
      enriched: enriched({ body: "yes", replyContext: { body: "Ship today?", sender: { jid: "15559990000@s.whatsapp.net", e164: "+15559990000" } } }),
      self: SELF,
    });
    expect(fromOther.admit && fromOther.event.body).toBe("[Reply to +15559990000] Ship today?\nyes");
    const toSelf = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(true),
      enriched: enriched({ body: "thanks", replyContext: { body: "x".repeat(250), sender: { jid: "15550001111@s.whatsapp.net" } } }),
      self: SELF,
    });
    expect(toSelf.admit && toSelf.event.body).toBe(`[Reply to you] ${"x".repeat(200)}…\nthanks`);
  });

  it("adds a shared location's labels and a shared contact as upstream's context blocks", () => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(false),
      enriched: enriched({
        body: "📍 10.7769, 106.7009",
        location: { latitude: 10.7769, longitude: 106.7009, name: "Ben Thanh Market", address: "District 1" },
        contactContext: { kind: "contact", total: 1, contacts: [{ name: "Lan", phones: ["+84901234567"] }] },
      }),
      self: SELF,
    });
    const body = build.admit ? build.event.body : "";
    expect(body.startsWith("📍 10.7769, 106.7009\n\nLocation: ⟦openclaw:ctx⟧\n```json\n")).toBe(true);
    expect(body).toContain('"name":"Ben Thanh Market"');
    expect(body).toContain("WhatsApp contact: ⟦openclaw:ctx⟧");
    expect(body).toContain('"phones":["+84901234567"]');
  });

  it("reads a command after a leading @mention", () => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(true),
      enriched: enriched({ body: "@15550001111 /status now", mentionedJids: [SELF.jid] }),
      self: SELF,
    });
    expect(build).toMatchObject({ admit: true, event: { kind: "command", facts: { command: { name: "status" } } } });
  });

  it("lists downloaded media in the shared [Attached files] manifest", () => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(false),
      enriched: enriched({ body: "look", mediaPath: "/hub/downloads/inbound/x-photo.jpg", mediaKind: "image", mediaType: "image/jpeg" }),
      self: SELF,
      mediaBytes: () => 2048,
    });
    expect(build.admit && build.event.body).toContain("look");
    expect(build.admit && build.event.body).toContain("/hub/downloads/inbound/x-photo.jpg");
  });

  it("admits a media-only message through its manifest", () => {
    const build = buildWhatsAppInboundEvent({
      msg: msg("M1"),
      inbound: inbound(false),
      enriched: enriched({ body: "", mediaPath: "/hub/downloads/inbound/doc.pdf", mediaKind: "document", mediaFileName: "doc.pdf" }),
      self: SELF,
    });
    expect(build.admit && build.event.body).toContain("doc.pdf");
  });

  it("skips a message without an id or without any content", () => {
    expect(buildWhatsAppInboundEvent({ msg: msg(undefined), inbound: inbound(false), enriched: enriched(), self: SELF })).toEqual({ admit: false, reason: "no-message-id" });
    expect(buildWhatsAppInboundEvent({ msg: msg("M1"), inbound: inbound(false), enriched: enriched({ body: "  " }), self: SELF })).toEqual({ admit: false, reason: "empty-body" });
  });
});

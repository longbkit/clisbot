import type { WAMessage } from "baileys";
import { describe, expect, it } from "vitest";
import { createWhatsAppCardIntake } from "./card-intake.js";
import { openWhatsAppCardStore } from "./reaction-cards.js";
import { createRecordingHostRuntime } from "./test-support.js";

const GROUP = "120363000000000003@g.us";

async function setup() {
  const { hostRuntime } = createRecordingHostRuntime();
  const cards = openWhatsAppCardStore(hostRuntime);
  await cards.register("PROMPT1", {
    chatJid: GROUP,
    choices: [
      { emoji: "👍", label: "Approve", value: "allow:card1" },
      { emoji: "👎", label: "Deny", value: "deny:card1" },
    ],
  });
  const admitted: Array<Record<string, unknown>> = [];
  const intake = createWhatsAppCardIntake({
    accountId: "a",
    cards,
    selfJid: () => "15550001111@s.whatsapp.net",
    resolveActorId: async (jid) => (jid.startsWith("15557778888") ? "+15557778888" : null),
    admit: async (event) => {
      admitted.push(event as unknown as Record<string, unknown>);
      return true;
    },
  });
  return { intake, admitted };
}

function reaction(emoji: string, target = "PROMPT1"): WAMessage {
  return {
    key: { id: "R1", remoteJid: GROUP, participant: "15557778888@s.whatsapp.net" },
    pushName: "Bob",
    message: { reactionMessage: { key: { id: target, remoteJid: GROUP }, text: emoji } },
  } as WAMessage;
}

describe("card intake (a reaction answers a prompt)", () => {
  it("turns 👍 on a prompt into the Approve button's callback, from the reactor", async () => {
    const { intake, admitted } = await setup();
    expect(await intake.handleReaction(reaction("👍🏻"))).toBe(true);
    expect(admitted).toEqual([
      expect.objectContaining({
        kind: "callback",
        externalConversationId: GROUP,
        senderId: "+15557778888",
        chatType: "group",
        facts: { callback: { actionId: "whatsapp-reaction", value: "allow:card1", actorId: "+15557778888", messageId: "PROMPT1" } },
      }),
    ]);
  });

  it("ignores a removed reaction, an unrelated emoji, or a message that is no prompt", async () => {
    const { intake, admitted } = await setup();
    expect(await intake.handleReaction(reaction(""))).toBe(true);
    expect(await intake.handleReaction(reaction("❤️"))).toBe(true);
    expect(await intake.handleReaction(reaction("👍", "OTHER"))).toBe(true);
    expect(admitted).toEqual([]);
    expect(await intake.handleReaction({ key: { id: "T", remoteJid: GROUP }, message: { conversation: "hi" } } as WAMessage)).toBe(false);
  });
});
